// Teste ponta a ponta da Edge Function play-turn contra o Supabase local.
//
// O Gemini e substituido pelo stub (scripts/gemini-stub.mjs), que valida o
// payload enviado. Assim exercitamos o caminho completo — auth, RLS, quota,
// gravacao do turno, aplicacao do delta — sem gastar token.
//
// Uso: node scripts/test-play-turn.mjs
// Requer: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY no ambiente.

const URL_BASE = process.env.SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!URL_BASE || !ANON || !SERVICE) {
  console.error('Faltam SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const EMAIL = 'jogador.e2e@teste.local'
const SENHA = 'senha-de-teste-12345'

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

async function setup() {
  // allowlist primeiro: o trigger recusa cadastro de quem nao foi convidado
  await svc('/rest/v1/allowlist', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ email: EMAIL, grant_role: 'player' }),
  })

  // usuario pode ja existir de uma execucao anterior
  const criar = await svc('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: SENHA, email_confirm: true }),
  })
  if (!criar.ok && criar.status !== 422) {
    throw new Error(`falha ao criar usuario: ${criar.status} ${await criar.text()}`)
  }

  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: SENHA }),
  })
  if (!login.ok) throw new Error(`falha no login: ${login.status} ${await login.text()}`)
  const { access_token: token, user } = await login.json()

  const sistema = await svc('/rest/v1/systems', {
    method: 'POST',
    body: JSON.stringify({
      slug: `sistema-e2e-${Date.now()}`,
      name: 'Sistema de Teste',
      is_published: true,
      rules_digest: 'Rolagens em 2d6. Sucesso a partir de 8. Dano fixo por arma.',
    }),
  })
  const [sistemaRow] = await sistema.json()

  const campanha = await svc('/rest/v1/campaigns', {
    method: 'POST',
    body: JSON.stringify({
      user_id: user.id,
      system_id: sistemaRow.id,
      title: 'Campanha E2E',
    }),
  })
  const [campanhaRow] = await campanha.json()

  await svc('/rest/v1/characters', {
    method: 'POST',
    body: JSON.stringify({
      campaign_id: campanhaRow.id,
      name: 'Vera',
      concept: 'Mercenaria endividada',
      hp_current: 20,
      hp_max: 20,
      attributes: { forca: 3, mente: 2 },
      inventory: ['adaga'],
    }),
  })

  await svc('/rest/v1/world_state', {
    method: 'POST',
    body: JSON.stringify({
      campaign_id: campanhaRow.id,
      current_location: 'Estrada de terra',
      present_npcs: [],
      weather: 'nublado',
      world_clock: '2000-01-01T08:00:00Z',
    }),
  })

  return { token, userId: user.id, campaignId: campanhaRow.id }
}

async function main() {
  const { token, userId, campaignId } = await setup()

  console.log('\n=== Turno valido ===')
  const res = await fetch(`${URL_BASE}/functions/v1/play-turn`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ campaign_id: campaignId, turn_type: 'act', player_input: 'Entro na taverna.' }),
  })
  const corpo = await res.json().catch(() => ({}))

  verifica('responde 200', res.status === 200, `status ${res.status}: ${JSON.stringify(corpo).slice(0, 300)}`)
  verifica('devolve narrativa', typeof corpo.narrative === 'string' && corpo.narrative.length > 50)
  verifica('devolve seq 1', corpo.seq === 1, `seq=${corpo.seq}`)
  verifica('devolve acoes sugeridas', Array.isArray(corpo.suggested_actions) && corpo.suggested_actions.length === 2)
  verifica('aplica dano na ficha (20 - 3)', corpo.character?.hp_current === 17, `hp=${corpo.character?.hp_current}`)
  verifica(
    'avanca o relogio do mundo em 12 min',
    corpo.world_clock === '2000-01-01T08:12:00.000Z',
    `clock=${corpo.world_clock}`,
  )
  verifica('conta thinking como output', corpo.usage?.outputTokens === 640, `out=${corpo.usage?.outputTokens}`)
  verifica('reporta quota restante', typeof corpo.quota?.turns_remaining === 'number')

  console.log('\n=== Estado gravado no banco ===')
  const turnos = await (await svc(`/rest/v1/turns?campaign_id=eq.${campaignId}&select=*`)).json()
  verifica('turno persistido', turnos.length === 1)
  verifica('narrativa gravada como markdown cru', turnos[0]?.narrative?.includes('**'))
  verifica('state_delta gravado', turnos[0]?.state_delta?.hp_change === -3)
  verifica('modelo registrado', turnos[0]?.model === 'gemini-3.7-flash', `model=${turnos[0]?.model}`)
  verifica(
    'tokens de entrada registrados',
    turnos[0]?.tokens_input === 3812,
    `in=${turnos[0]?.tokens_input}`,
  )

  const mundo = await (await svc(`/rest/v1/world_state?campaign_id=eq.${campaignId}&select=*`)).json()
  verifica('local atualizado', mundo[0]?.current_location === 'Taverna do Cao Torto')
  verifica('npcs atualizados', mundo[0]?.present_npcs?.length === 2)
  verifica('flag persistida', mundo[0]?.flags?.mulher_sabe_seu_nome === 'sim')

  const ficha = await (await svc(`/rest/v1/characters?campaign_id=eq.${campaignId}&select=*`)).json()
  verifica('item adicionado ao inventario', ficha[0]?.inventory?.includes('carta selada'))
  verifica('inventario manteve o que ja tinha', ficha[0]?.inventory?.includes('adaga'))

  const campanhas = await (await svc(`/rest/v1/campaigns?id=eq.${campaignId}&select=last_turn_seq`)).json()
  verifica('last_turn_seq avancou', campanhas[0]?.last_turn_seq === 1)

  const uso = await (await svc(`/rest/v1/usage_daily?user_id=eq.${userId}&select=*`)).json()
  verifica('quota consumida', uso[0]?.turns_count === 1, `turns=${uso[0]?.turns_count}`)
  verifica('tokens contabilizados', uso[0]?.tokens_output === 850, `out=${uso[0]?.tokens_output}`)

  console.log('\n=== Validacao de entrada ===')
  const casos = [
    { nome: 'recusa turn_type invalido', body: { campaign_id: campaignId, turn_type: 'dancar' }, status: 400 },
    { nome: 'recusa speak sem texto', body: { campaign_id: campaignId, turn_type: 'speak' }, status: 400 },
    { nome: 'recusa sem campaign_id', body: { turn_type: 'continue' }, status: 400 },
    {
      nome: 'recusa campanha inexistente',
      body: { campaign_id: '00000000-0000-0000-0000-000000000000', turn_type: 'continue' },
      status: 404,
    },
  ]
  for (const caso of casos) {
    const r = await fetch(`${URL_BASE}/functions/v1/play-turn`, {
      method: 'POST',
      headers: { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(caso.body),
    })
    verifica(caso.nome, r.status === caso.status, `esperava ${caso.status}, veio ${r.status}`)
  }

  console.log('\n=== Sem autenticacao ===')
  const semAuth = await fetch(`${URL_BASE}/functions/v1/play-turn`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ campaign_id: campaignId, turn_type: 'continue' }),
  })
  verifica('recusa chamada sem JWT', semAuth.status === 401, `status ${semAuth.status}`)

  console.log('\n=== Quota esgotada ===')
  await svc(`/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ daily_turn_limit: 1 }),
  })
  const estourado = await fetch(`${URL_BASE}/functions/v1/play-turn`, {
    method: 'POST',
    headers: { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ campaign_id: campaignId, turn_type: 'continue' }),
  })
  const corpoEstourado = await estourado.json().catch(() => ({}))
  verifica('responde 429 ao estourar a quota', estourado.status === 429, `status ${estourado.status}`)
  verifica(
    'mensagem explica o limite',
    /Limite diario/.test(corpoEstourado.error ?? ''),
    corpoEstourado.error,
  )

  console.log('\n===================================')
  console.log(` ${passou} passaram, ${falhou} falharam`)
  console.log('===================================')
  process.exit(falhou > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('erro no teste:', e.message)
  process.exit(1)
})
