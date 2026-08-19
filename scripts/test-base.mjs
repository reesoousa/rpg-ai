// Teste ponta a ponta das Edge Functions da base, contra o Supabase local.
//
// O Gemini e substituido pelo stub, que valida o payload enviado. Cobre:
// start-campaign, character-wizard, ingest-rulebook, extract-adventure e
// generate-scene — incluindo quem tem permissao para o que.
//
// Uso: node scripts/test-base.mjs

const URL_BASE = process.env.SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!URL_BASE || !ANON || !SERVICE) {
  console.error('Faltam SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const MESTRE = { email: 'mestre.base@teste.local', senha: 'senha-de-teste-12345' }
const JOGADOR = { email: 'jogador.base@teste.local', senha: 'senha-de-teste-12345' }

let passou = 0
let falhou = 0

function verifica(nome, condicao, detalhe = '') {
  if (condicao) {
    console.log(`  PASS  ${nome}`)
    passou++
  } else {
    console.log(`  FAIL  ${nome}${detalhe ? `\n        ${detalhe}` : ''}`)
    falhou++
  }
}

const svc = (caminho, init = {}) =>
  fetch(`${URL_BASE}${caminho}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      authorization: `Bearer ${SERVICE}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  })

const chamarFn = (nome, token, body) =>
  fetch(`${URL_BASE}/functions/v1/${nome}`, {
    method: 'POST',
    headers: { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

async function criarUsuario({ email, senha }, papel) {
  await svc('/rest/v1/allowlist', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ email, grant_role: papel }),
  })
  const r = await svc('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password: senha, email_confirm: true }),
  })
  if (!r.ok && r.status !== 422) {
    throw new Error(`falha ao criar ${email}: ${r.status} ${await r.text()}`)
  }
  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: senha }),
  })
  if (!login.ok) throw new Error(`falha no login de ${email}: ${await login.text()}`)
  const { access_token, user } = await login.json()
  return { token: access_token, id: user.id }
}

/** PDF minimo valido. O stub nao le o conteudo; o Storage confere o mime type. */
function pdfDeTeste() {
  const corpo = [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj',
    'trailer<</Root 1 0 R>>',
    '%%EOF',
  ].join('\n')
  return Buffer.from(corpo, 'latin1')
}

async function main() {
  const mestre = await criarUsuario(MESTRE, 'master')
  const jogador = await criarUsuario(JOGADOR, 'player')

  // limpa consumo de execucoes anteriores
  await svc('/rest/v1/usage_daily?user_id=neq.00000000-0000-0000-0000-000000000000', {
    method: 'DELETE',
  })

  const [sistema] = await (
    await svc('/rest/v1/systems', {
      method: 'POST',
      body: JSON.stringify({
        slug: `base-e2e-${Date.now()}`,
        name: 'Sistema de Teste',
        is_published: true,
      }),
    })
  ).json()

  console.log('\n=== ingest-rulebook (so mestre) ===')

  // sobe o PDF como service_role
  const caminhoPdf = `${sistema.id}/manual.pdf`
  const up = await fetch(`${URL_BASE}/storage/v1/object/rulebooks/${caminhoPdf}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE,
      authorization: `Bearer ${SERVICE}`,
      'content-type': 'application/pdf',
      'x-upsert': 'true',
    },
    body: pdfDeTeste(),
  })
  verifica('PDF sobe para o bucket rulebooks', up.ok, `status ${up.status}: ${await up.clone().text()}`)

  const [livro] = await (
    await svc('/rest/v1/rulebooks', {
      method: 'POST',
      body: JSON.stringify({
        system_id: sistema.id,
        title: 'Manual de Teste',
        storage_path: caminhoPdf,
        page_count: 120,
        uploaded_by: mestre.id,
      }),
    })
  ).json()

  const negado = await chamarFn('ingest-rulebook', jogador.token, { rulebook_id: livro.id })
  verifica('jogador comum recebe 403', negado.status === 403, `status ${negado.status}`)

  const ingest = await chamarFn('ingest-rulebook', mestre.token, {
    rulebook_id: livro.id,
    publish: true,
  })
  const ingestCorpo = await ingest.json().catch(() => ({}))
  verifica('mestre ingere o livro', ingest.status === 200, `status ${ingest.status}: ${JSON.stringify(ingestCorpo).slice(0, 200)}`)
  verifica('devolve digest operacional', (ingestCorpo.digest ?? '').includes('2d6'))
  verifica('estima custo pelas paginas (120 x 258)', ingestCorpo.usage?.estimated_from_pages === 30960, `veio ${ingestCorpo.usage?.estimated_from_pages}`)

  const [sisAtualizado] = await (
    await svc(`/rest/v1/systems?id=eq.${sistema.id}&select=rules_digest`)
  ).json()
  verifica('publica o digest em systems.rules_digest', Boolean(sisAtualizado?.rules_digest))

  const [livroAtualizado] = await (
    await svc(
      `/rest/v1/rulebooks?id=eq.${livro.id}&select=ingested_at,ingest_tokens_input,storage_path,file_deleted_at,original_size_bytes`,
    )
  ).json()
  verifica('registra custo real da ingestao', livroAtualizado?.ingest_tokens_input === 3812)
  verifica('marca ingested_at', Boolean(livroAtualizado?.ingested_at))

  // --- o PDF nao deve ficar guardado ocupando Storage
  verifica('reporta que apagou o arquivo', ingestCorpo.file_deleted === true, `veio ${ingestCorpo.file_deleted}`)
  verifica('limpa o storage_path', livroAtualizado?.storage_path === null, `veio ${livroAtualizado?.storage_path}`)
  verifica('marca file_deleted_at', Boolean(livroAtualizado?.file_deleted_at))
  verifica('guarda o tamanho original antes de apagar', livroAtualizado?.original_size_bytes > 0)

  const pdfSumiu = await fetch(`${URL_BASE}/storage/v1/object/rulebooks/${caminhoPdf}`, {
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` },
  })
  // O Storage responde 400 para objeto ausente, nao 404.
  verifica('PDF realmente saiu do bucket', pdfSumiu.status === 400 || pdfSumiu.status === 404, `status ${pdfSumiu.status}`)

  const reingerir = await chamarFn('ingest-rulebook', mestre.token, { rulebook_id: livro.id })
  const reingerirCorpo = await reingerir.json().catch(() => ({}))
  verifica('reingerir sem arquivo da erro explicativo', reingerir.status === 409, `status ${reingerir.status}`)
  verifica('mensagem explica que precisa subir de novo', /apagado/.test(reingerirCorpo.error ?? ''), reingerirCorpo.error)

  console.log('\n=== extract-adventure (so mestre) ===')

  const [aventura] = await (
    await svc('/rest/v1/adventures', {
      method: 'POST',
      body: JSON.stringify({
        system_id: sistema.id,
        slug: `aventura-e2e-${Date.now()}`,
        title: 'O Filho do Prefeito',
        synopsis: 'Um desaparecimento na cidade.',
        is_published: true,
      }),
    })
  ).json()

  const extNegado = await chamarFn('extract-adventure', jogador.token, {
    adventure_id: aventura.id,
    source_text: 'texto qualquer',
  })
  verifica('jogador comum recebe 403 na extracao', extNegado.status === 403)

  const semTexto = await chamarFn('extract-adventure', mestre.token, { adventure_id: aventura.id })
  verifica('recusa extrair sem source_text', semTexto.status === 409, `status ${semTexto.status}`)

  const ext = await chamarFn('extract-adventure', mestre.token, {
    adventure_id: aventura.id,
    source_text: 'O filho do prefeito desapareceu. O moinho abandonado guarda pistas.',
  })
  const extCorpo = await ext.json().catch(() => ({}))
  verifica('mestre extrai a aventura', ext.status === 200, `status ${ext.status}: ${JSON.stringify(extCorpo).slice(0, 200)}`)
  verifica('grava 4 entidades', extCorpo.entities_count === 4, `veio ${extCorpo.entities_count}`)
  verifica('agrupa por tipo', extCorpo.entities_by_kind?.npc === 1 && extCorpo.entities_by_kind?.location === 1)
  verifica('reporta que nao truncou', extCorpo.truncated === false)

  const entidades = await (
    await svc(`/rest/v1/adventure_entities?adventure_id=eq.${aventura.id}&select=*`)
  ).json()
  verifica('entidades persistidas no banco', entidades.length === 4)
  const npc = entidades.find((e) => e.kind === 'npc')
  verifica('pares viraram objeto no jsonb', npc?.data?.segredo?.includes('divida'), JSON.stringify(npc?.data))

  // reexecutar nao deve duplicar
  await chamarFn('extract-adventure', mestre.token, { adventure_id: aventura.id })
  const reexec = await (
    await svc(`/rest/v1/adventure_entities?adventure_id=eq.${aventura.id}&select=id`)
  ).json()
  verifica('reexecutar substitui em vez de duplicar', reexec.length === 4, `veio ${reexec.length}`)

  console.log('\n=== character-wizard ===')

  const wiz = await chamarFn('character-wizard', jogador.token, { system_id: sistema.id })
  const wizCorpo = await wiz.json().catch(() => ({}))
  verifica('wizard responde', wiz.status === 200, `status ${wiz.status}: ${JSON.stringify(wizCorpo).slice(0, 200)}`)
  verifica('devolve pergunta', (wizCorpo.reply ?? '').length > 20)
  verifica('ainda nao esta pronto', wizCorpo.ready === false)
  verifica('nao devolve ficha antes da hora', wizCorpo.character === null)

  const wizLongo = await chamarFn('character-wizard', jogador.token, {
    system_id: sistema.id,
    messages: Array.from({ length: 13 }, () => ({ role: 'user', text: 'oi' })),
  })
  verifica('recusa conversa longa demais', wizLongo.status === 400, `status ${wizLongo.status}`)

  console.log('\n=== start-campaign ===')

  const semNome = await chamarFn('start-campaign', jogador.token, {
    system_id: sistema.id,
    title: 'Campanha X',
    character: { concept: 'sem nome' },
  })
  verifica('recusa personagem sem nome', semNome.status === 400, `status ${semNome.status}`)

  const hpInvalido = await chamarFn('start-campaign', jogador.token, {
    system_id: sistema.id,
    title: 'Campanha X',
    character: { name: 'Vera', concept: 'Mercenaria', hp_max: 0 },
  })
  verifica('recusa hp_max invalido', hpInvalido.status === 400, `status ${hpInvalido.status}`)

  const start = await chamarFn('start-campaign', jogador.token, {
    system_id: sistema.id,
    adventure_id: aventura.id,
    title: 'A Estrada de Vale Cinza',
    character: {
      name: 'Vera Dorn',
      concept: 'Mercenaria endividada',
      hp_max: 22,
      attributes: [{ key: 'forca', value: '3' }],
      skills: ['Intimidar'],
      inventory: ['adaga'],
    },
  })
  const startCorpo = await start.json().catch(() => ({}))
  verifica('abre a campanha', start.status === 200, `status ${start.status}: ${JSON.stringify(startCorpo).slice(0, 300)}`)
  verifica('devolve narrativa de abertura', (startCorpo.narrative ?? '').length > 80)
  verifica('abertura e o turno 1', startCorpo.seq === 1)
  verifica('define o local inicial', startCorpo.location === 'Portao de Vale Cinza', startCorpo.location)

  const campaignId = startCorpo.campaign_id
  const turnos = await (
    await svc(`/rest/v1/turns?campaign_id=eq.${campaignId}&select=turn_type,seq,narrative`)
  ).json()
  verifica('turno gravado como opening', turnos[0]?.turn_type === 'opening', turnos[0]?.turn_type)

  const mundo = await (
    await svc(`/rest/v1/world_state?campaign_id=eq.${campaignId}&select=*`)
  ).json()
  verifica('estado do mundo criado', mundo[0]?.current_location === 'Portao de Vale Cinza')
  verifica('npcs da abertura registrados', mundo[0]?.present_npcs?.length === 1)

  const ficha = await (
    await svc(`/rest/v1/characters?campaign_id=eq.${campaignId}&select=*`)
  ).json()
  verifica('ficha criada com hp cheio', ficha[0]?.hp_current === 22 && ficha[0]?.hp_max === 22)
  verifica('atributos convertidos de pares para objeto', ficha[0]?.attributes?.forca === '3', JSON.stringify(ficha[0]?.attributes))

  console.log('\n=== generate-scene ===')

  const cenaAlheia = await chamarFn('generate-scene', mestre.token, { campaign_id: campaignId })
  verifica('nao gera cena de campanha alheia', cenaAlheia.status === 404, `status ${cenaAlheia.status}`)

  const cena = await chamarFn('generate-scene', jogador.token, { campaign_id: campaignId })
  const cenaCorpo = await cena.json().catch(() => ({}))
  verifica('gera a cena', cena.status === 200, `status ${cena.status}: ${JSON.stringify(cenaCorpo).slice(0, 300)}`)
  verifica('prompt inclui o local do mundo', (cenaCorpo.prompt ?? '').includes('Portao de Vale Cinza'))
  verifica('reporta quota de imagem', typeof cenaCorpo.quota?.images_remaining === 'number')

  // --- a imagem volta na resposta, nao no Storage
  verifica('devolve a imagem em base64', (cenaCorpo.image_base64 ?? '').length > 50)
  verifica('informa o mime type', (cenaCorpo.mime_type ?? '').startsWith('image/'), cenaCorpo.mime_type)
  verifica('informa o tamanho', cenaCorpo.size_bytes > 0)
  verifica('nao devolve URL de storage', !('signed_url' in cenaCorpo) && !('storage_path' in cenaCorpo))

  const turnoComCena = await (
    await svc(`/rest/v1/turns?campaign_id=eq.${campaignId}&select=seq,scene_prompt,scene_generated_at&order=seq`)
  ).json()
  const turnoUltimo = turnoComCena[turnoComCena.length - 1]
  verifica('guarda o prompt no turno', (turnoUltimo?.scene_prompt ?? '').includes('Portao de Vale Cinza'))
  verifica('marca quando gerou', Boolean(turnoUltimo?.scene_generated_at))

  console.log('\n=== regerar cena a partir do prompt guardado ===')
  const regerar = await chamarFn('generate-scene', jogador.token, {
    campaign_id: campaignId,
    regenerate_turn_seq: turnoUltimo.seq,
  })
  const regerarCorpo = await regerar.json().catch(() => ({}))
  verifica('regera a cena', regerar.status === 200, `status ${regerar.status}: ${JSON.stringify(regerarCorpo).slice(0, 200)}`)
  verifica('marca como regerada', regerarCorpo.regenerated === true)
  verifica('reusa o MESMO prompt', regerarCorpo.prompt === turnoUltimo.scene_prompt)

  const semCena = await chamarFn('generate-scene', jogador.token, {
    campaign_id: campaignId,
    regenerate_turn_seq: 99,
  })
  verifica('recusa regerar turno inexistente', semCena.status === 404, `status ${semCena.status}`)

  const uso = await (await svc(`/rest/v1/usage_daily?user_id=eq.${jogador.id}&select=*`)).json()
  // duas geracoes: a cena original e a regerada. Regerar custa quota.
  verifica('cada geracao conta uma vez na quota', uso[0]?.images_count === 2, `images=${uso[0]?.images_count}`)

  await svc(`/rest/v1/profiles?id=eq.${jogador.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ daily_image_limit: 2 }),
  })
  const cenaEstourada = await chamarFn('generate-scene', jogador.token, { campaign_id: campaignId })
  verifica('429 ao estourar a quota de imagem', cenaEstourada.status === 429, `status ${cenaEstourada.status}`)

  console.log('\n=== nada pesado ficou no Storage ===')
  const buckets = await fetch(`${URL_BASE}/storage/v1/bucket`, {
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` },
  })
  const listaBuckets = await buckets.json().catch(() => [])
  const nomes = Array.isArray(listaBuckets) ? listaBuckets.map((b) => b.id ?? b.name) : []
  verifica('bucket de cenas nao existe mais', !nomes.includes('scenes'), `buckets: ${nomes.join(', ')}`)
  verifica('bucket de livros continua (upload temporario)', nomes.includes('rulebooks'), `buckets: ${nomes.join(', ')}`)

  console.log('\n===================================')
  console.log(` ${passou} passaram, ${falhou} falharam`)
  console.log('===================================')
  process.exit(falhou > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('erro no teste:', e.message)
  process.exit(1)
})
