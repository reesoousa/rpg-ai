// Sonda da API do Gemini: descobre o que a API REAL aceita.
//
// POR QUE ISTO EXISTE
// Todo o teste automatizado do projeto usa o stub (scripts/gemini-stub.mjs),
// que valida o payload mas nunca chamou a API. Tres coisas ficaram no chute:
//
//   1. o nome do campo de thinking no generateContent
//   2. se maxOutputTokens sobra para o texto depois do thinking
//   3. se a geracao de imagem usa POST /interactions
//
// A sonda responde as tres com fato, nao com documentacao.
//
// A CHAVE NAO ENTRA NO REPO. Ela e lida do ambiente e a saida e filtrada:
// se a chave aparecer em qualquer resposta da API, sai como <chave>.
//
// Uso (PowerShell):
//   $env:GEMINI_API_KEY = "<sua chave>"
//   node scripts/probe-gemini.mjs
//
// Uso (bash):
//   GEMINI_API_KEY=... node scripts/probe-gemini.mjs
//
// A sonda gasta pouco: os prompts sao minimos e maxOutputTokens fica baixo.
// A geracao de imagem custa mais, entao so roda com --image.

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
const CHAVE = process.env.GEMINI_API_KEY

if (!CHAVE) {
  console.error('Falta GEMINI_API_KEY no ambiente. A chave nao vai para arquivo nenhum.')
  process.exit(1)
}

const COM_IMAGEM = process.argv.includes('--image')

/** Modelos que o codigo usa hoje. */
const MODELOS = {
  turno: process.env.GEMINI_MODEL_TURN ?? 'gemini-3.7-flash',
  wizard: process.env.GEMINI_MODEL_WIZARD ?? 'gemini-3.1-flash-lite',
  imagem: process.env.GEMINI_MODEL_IMAGE ?? 'gemini-3.1-flash-image',
}

/** Nunca deixa a chave escapar para o terminal ou para um log colado em chat. */
function limpar(texto) {
  return String(texto).split(CHAVE).join('<chave>')
}

function log(...partes) {
  console.log(limpar(partes.join(' ')))
}

function titulo(texto) {
  console.log('')
  console.log(`--- ${texto} ${'-'.repeat(Math.max(0, 66 - texto.length))}`)
}

/**
 * Statuses que o cliente repete — a sonda tem de repetir tambem.
 *
 * Sem isto ela devolve falso-negativo: foi assim que a primeira rodada deixou
 * `thinkingConfig.thinkingLevel` e `sem thinking` marcados como 503, sem
 * responder se a variante presta.
 */
const REPETIVEIS = new Set([429, 500, 502, 503, 504])

async function chamar(url, corpo, tentativas = 3) {
  let ultimo = null

  for (let i = 0; i < tentativas; i++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': CHAVE },
      body: JSON.stringify(corpo),
    })
    const texto = await res.text()
    let payload = null
    try {
      payload = JSON.parse(texto)
    } catch {
      payload = texto
    }

    ultimo = { status: res.status, ok: res.ok, payload, texto, tentativas: i + 1 }
    if (!REPETIVEIS.has(res.status)) return ultimo

    if (i < tentativas - 1) {
      await new Promise((r) => setTimeout(r, 700 * 2 ** i + Math.random() * 300))
    }
  }

  return ultimo
}

// ---------------------------------------------------------------------------
// 1. Quais modelos a chave alcanca de fato
//
// Modelo inexistente da 404 e modelo fora do tier da 429 ou 403. Os dois
// chegam ao app como o mesmo "Falha ao gerar", entao vale separar aqui.
// ---------------------------------------------------------------------------
async function listarModelos() {
  titulo('1. modelos visiveis para esta chave')

  const res = await fetch(`${BASE}/models?pageSize=1000`, {
    headers: { 'x-goog-api-key': CHAVE },
  })
  if (!res.ok) {
    log(`FALHOU: GET /models respondeu ${res.status}`)
    log(limpar(await res.text()).slice(0, 600))
    return null
  }

  const { models = [] } = await res.json()
  const nomes = models.map((m) => m.name.replace(/^models\//, ''))

  for (const [papel, modelo] of Object.entries(MODELOS)) {
    const existe = nomes.includes(modelo)
    log(`${existe ? 'OK   ' : 'AUSENTE'} ${papel.padEnd(7)} ${modelo}`)
  }

  const flash = nomes.filter((n) => /flash/.test(n) && !/tts|live|audio|robotics/.test(n))
  log('')
  log(`flash disponiveis (${flash.length}):`)
  for (const n of flash) log(`  ${n}`)

  return nomes
}

// ---------------------------------------------------------------------------
// 2. Qual variante de thinking o generateContent aceita
//
// JA MEDIDO em gemini-3.7-flash:
//   generationConfig.thinkingLevel         -> 400 Unknown name "thinkingLevel"
//   thinkingConfig.thinkingBudget          -> 200 STOP
//   thinkingConfig.thinkingLevel           -> 503 (inconclusivo na 1a rodada)
//
// O cliente agora tenta na ordem budget -> level -> nada. A sonda repete a
// ordem para confirmar, e com retry: sem retry, um 503 passageiro faz uma
// variante boa parecer rejeitada.
// ---------------------------------------------------------------------------
const ESQUEMA = {
  type: 'object',
  properties: { narrative: { type: 'string' } },
  required: ['narrative'],
}

const CATEGORIAS = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
  'HARM_CATEGORY_CIVIC_INTEGRITY',
]

function corpoBase(maxOutputTokens) {
  return {
    contents: [
      { role: 'user', parts: [{ text: 'Descreva uma taverna em duas frases.' }] },
    ],
    systemInstruction: { parts: [{ text: 'Voce narra um RPG em portugues do Brasil.' }] },
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens,
      responseMimeType: 'application/json',
      responseSchema: ESQUEMA,
    },
    safetySettings: CATEGORIAS.map((category) => ({ category, threshold: 'OFF' })),
  }
}

// Ordem igual a do cliente: a comprovada primeiro.
const VARIANTES = [
  [
    'thinkingConfig.thinkingBudget',
    (g) => ({ ...g, thinkingConfig: { thinkingBudget: 512 } }),
  ],
  [
    'thinkingConfig.thinkingLevel',
    (g, v) => ({ ...g, thinkingConfig: { thinkingLevel: v } }),
  ],
  ['generationConfig.thinkingLevel', (g, v) => ({ ...g, thinkingLevel: v })],
  ['sem thinking', (g) => g],
]

async function testarThinking(modelo) {
  titulo(`2. thinking no generateContent (${modelo})`)

  for (const [nome, aplicar] of VARIANTES) {
    const corpo = corpoBase(2048)
    corpo.generationConfig = aplicar(corpo.generationConfig, 'low')

    const r = await chamar(`${BASE}/models/${modelo}:generateContent`, corpo)

    if (!r.ok) {
      const msg = r.payload?.error?.message ?? r.texto
      log(
        `${nome.padEnd(30)} ${r.status}  ${limpar(msg).slice(0, 190)}` +
          (r.tentativas > 1 ? ` (desistiu apos ${r.tentativas})` : ''),
      )
      continue
    }

    const c = r.payload.candidates?.[0]
    const texto = (c?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    const u = r.payload.usageMetadata ?? {}

    log(
      `${nome.padEnd(30)} 200  finish=${c?.finishReason}  ` +
        `prompt=${u.promptTokenCount ?? 0} out=${u.candidatesTokenCount ?? 0} ` +
        `thoughts=${u.thoughtsTokenCount ?? 0}  texto=${texto.length}ch` +
        (r.tentativas > 1 ? `  (${r.tentativas} tentativas)` : ''),
    )
    if (!texto.trim()) {
      log('     ^ ATENCAO: 200 com texto vazio. E aqui que o app diz "conteudo vazio".')
    }
  }
}

// ---------------------------------------------------------------------------
// 3. O thinking come o maxOutputTokens?
//
// Se sim, um turno com maxOutputTokens=2048 e thinking ligado volta com
// finishReason=MAX_TOKENS e parts vazio — o modo de falha mais provavel do
// play-turn hoje.
// ---------------------------------------------------------------------------
async function testarOrcamento(modelo, variante) {
  titulo(`3. maxOutputTokens x thinking (${modelo}, via ${variante[0]})`)

  for (const teto of [512, 2048, 8192]) {
    const corpo = corpoBase(teto)
    corpo.generationConfig = variante[1](corpo.generationConfig, 'low')
    corpo.contents = [
      {
        role: 'user',
        parts: [
          {
            text:
              'Abra uma campanha de fantasia sombria. Entre 120 e 280 palavras, ' +
              'segunda pessoa, presente.',
          },
        ],
      },
    ]

    const r = await chamar(`${BASE}/models/${modelo}:generateContent`, corpo)
    if (!r.ok) {
      log(
        `max=${String(teto).padEnd(5)} ${r.status} ${limpar(r.payload?.error?.message ?? '').slice(0, 160)}`,
      )
      continue
    }

    const c = r.payload.candidates?.[0]
    const texto = (c?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    const u = r.payload.usageMetadata ?? {}
    log(
      `max=${String(teto).padEnd(5)} finish=${String(c?.finishReason).padEnd(11)} ` +
        `out=${u.candidatesTokenCount ?? 0} thoughts=${u.thoughtsTokenCount ?? 0} ` +
        `texto=${texto.length}ch ${texto.trim() ? '' : '<-- VAZIO'}`,
    )
  }
}

// ---------------------------------------------------------------------------
// 4. Geracao de imagem: /interactions ou generateContent?
//
// Este e o unico caminho do projeto escrito sem nenhuma confirmacao. So roda
// com --image porque imagem custa bem mais que texto.
// ---------------------------------------------------------------------------
async function testarImagem(modelo) {
  titulo(`4. geracao de imagem (${modelo})`)

  const prompt = 'Uma taverna de pedra a noite, luz de vela, estilo pintura digital.'

  const viaInteractions = await chamar(`${BASE}/interactions`, {
    model: modelo,
    input: [{ type: 'text', text: prompt }],
    response_format: {
      type: 'image',
      mime_type: 'image/jpeg',
      aspect_ratio: '16:9',
      image_size: '1K',
    },
  })
  log(`POST /interactions            ${viaInteractions.status}`)
  if (!viaInteractions.ok) {
    log(
      `  ${limpar(viaInteractions.payload?.error?.message ?? viaInteractions.texto).slice(0, 300)}`,
    )
  } else {
    log(`  chaves da resposta: ${Object.keys(viaInteractions.payload).join(', ')}`)
  }

  const viaGenerate = await chamar(`${BASE}/models/${modelo}:generateContent`, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'] },
  })
  log(`POST :generateContent (IMAGE) ${viaGenerate.status}`)
  if (!viaGenerate.ok) {
    log(
      `  ${limpar(viaGenerate.payload?.error?.message ?? viaGenerate.texto).slice(0, 300)}`,
    )
  } else {
    const partes = viaGenerate.payload.candidates?.[0]?.content?.parts ?? []
    const tipos = partes.map((p) => Object.keys(p).join('+')).join(', ')
    log(`  partes: ${tipos || '(nenhuma)'}`)
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 5. Disponibilidade: qual modelo de fato responde
//
// Esta secao existe por causa do achado que explicou tudo. A primeira rodada
// pegou 503 "This model is currently experiencing high demand" em metade das
// chamadas a gemini-3.7-flash, enquanto o wizard — a unica coisa que funcionava
// no app — usava gemini-3.1-flash-lite. Nao era codigo: era o modelo mais
// disputado da familia recusando atender.
//
// O cliente agora repete no 503. Mas escolher o modelo do turno com base em
// medicao vale mais do que apostar no numero de versao mais alto: a diferenca
// aqui e sentida como turno que abre ou turno que trava.
// ---------------------------------------------------------------------------
const AMOSTRAS = Number(process.env.PROBE_AMOSTRAS ?? 4)

async function medirDisponibilidade(nomes) {
  titulo(`5. disponibilidade (${AMOSTRAS} chamadas por modelo, sem retry)`)

  const candidatos = [
    MODELOS.turno,
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-flash-latest',
    MODELOS.wizard,
  ].filter((m, i, a) => a.indexOf(m) === i && (!nomes || nomes.includes(m)))

  for (const modelo of candidatos) {
    let ok = 0
    let sobrecarga = 0
    let outro = ''
    let somaMs = 0

    for (let i = 0; i < AMOSTRAS; i++) {
      const corpo = corpoBase(512)
      corpo.generationConfig = {
        ...corpo.generationConfig,
        thinkingConfig: { thinkingBudget: 0 },
      }
      const t0 = Date.now()
      // tentativas = 1: aqui a intencao e MEDIR a taxa de recusa, nao contorna-la.
      const r = await chamar(`${BASE}/models/${modelo}:generateContent`, corpo, 1)
      somaMs += Date.now() - t0

      if (r.ok) ok++
      else if (REPETIVEIS.has(r.status)) sobrecarga++
      else outro = `${r.status} ${limpar(r.payload?.error?.message ?? '').slice(0, 90)}`
    }

    const media = Math.round(somaMs / AMOSTRAS)
    log(
      `${modelo.padEnd(26)} ok=${ok}/${AMOSTRAS}  sobrecarga=${sobrecarga}  ` +
        `media=${media}ms${outro ? `  outro: ${outro}` : ''}`,
    )
  }

  log('')
  log('Modelo com sobrecarga alta e candidato a sair do padrao do turno.')
  log('Trocar sem mexer no codigo: secret GEMINI_MODEL_TURN na Edge Function.')
}

async function main() {
  log('Sonda do Gemini. A chave e lida do ambiente e nunca aparece na saida.')

  const nomes = await listarModelos()

  const modeloTurno =
    nomes && !nomes.includes(MODELOS.turno)
      ? (nomes.find((n) => /^gemini-3\.\d+-flash$/.test(n)) ?? MODELOS.turno)
      : MODELOS.turno

  if (modeloTurno !== MODELOS.turno) {
    log('')
    log(`${MODELOS.turno} nao esta na lista. Seguindo os testes com ${modeloTurno}.`)
  }

  await testarThinking(modeloTurno)

  // Repete o teste de orcamento com a variante que passou, para separar
  // "campo rejeitado" de "resposta vazia por falta de teto".
  const aceita = VARIANTES[0]
  await testarOrcamento(modeloTurno, aceita)

  if (COM_IMAGEM) {
    await testarImagem(MODELOS.imagem)
  } else {
    titulo('4. geracao de imagem')
    log('pulado. Rode com --image para testar (custa mais que os testes de texto).')
  }

  await medirDisponibilidade(nomes)

  console.log('')
  log('Fim. Cole a saida inteira: nenhuma linha dela contem a chave.')
}

await main()
