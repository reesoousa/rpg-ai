// Teste do cliente do Gemini contra um servidor programavel, em Node.
//
// POR QUE ISTO EXISTE
// Os outros dois arquivos de teste (test-play-turn, test-base) precisam de
// Docker: Supabase local, functions serve, stub. Isso e certo para testar o
// caminho completo, e errado para testar o cliente HTTP — que e onde estava a
// falha que derrubou a IA em producao.
//
// O cliente tratava qualquer status nao-400 como definitivo. Um 503 "high
// demand" de segundos virava turno perdido. Nenhum teste pegava isso, porque o
// stub sempre responde 200 e ninguem ia programa-lo para oscilar.
//
// Aqui o servidor e programavel: ele responde a sequencia que o teste pedir.
// Roda em segundos, sem container.
//
// `_shared/gemini.ts` nao importa nada, entao o Node carrega o arquivo direto
// com transformacao de tipos. So precisa de um `Deno.env` de mentira.
//
// Uso: node --experimental-transform-types scripts/test-gemini-client.mjs
//   ou: pnpm test:gemini

import { createServer } from 'node:http'

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

// ---------------------------------------------------------------------------
// Servidor programavel
//
// `fila` guarda o que responder, uma entrada por chamada. Esgotada a fila,
// repete a ultima — assim um teste de "sempre 503" nao precisa enfileirar N.
// ---------------------------------------------------------------------------
const recebidos = []
let fila = []

function respostaOk(dados, extras = {}) {
  return {
    status: 200,
    corpo: {
      candidates: [
        { content: { parts: [{ text: JSON.stringify(dados) }] }, finishReason: 'STOP' },
      ],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 50,
        thoughtsTokenCount: 10,
      },
      ...extras,
    },
  }
}

const servidor = createServer((req, res) => {
  let cru = ''
  req.on('data', (c) => (cru += c))
  req.on('end', () => {
    let corpo = null
    try {
      corpo = JSON.parse(cru)
    } catch {
      /* registra como veio */
    }
    recebidos.push({ url: req.url, corpo })

    const proxima = fila.length > 1 ? fila.shift() : (fila[0] ?? respostaOk({ ok: true }))
    res.writeHead(proxima.status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(proxima.corpo ?? {}))
  })
})

await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
const porta = servidor.address().port

// ---------------------------------------------------------------------------
// Ambiente de mentira. Tem de existir ANTES do import do modulo, porque
// `apiKey()` e `endpoint()` leem de Deno.env em tempo de chamada — mas o modulo
// referencia o global no topo do escopo.
// ---------------------------------------------------------------------------
const ambiente = {
  GEMINI_API_KEY: 'chave-de-mentira',
  GEMINI_API_BASE: `http://127.0.0.1:${porta}/v1beta`,
}
globalThis.Deno = { env: { get: (k) => ambiente[k] } }

const { generateStructured, GeminiError, GeminiSemSaidaError, GeminiSobrecargaError } =
  await import('../supabase/functions/_shared/gemini.ts')

const ESQUEMA = { type: 'object', properties: { ok: { type: 'boolean' } } }

function chamar(extras = {}) {
  return generateStructured({
    model: 'gemini-3.7-flash',
    contents: [{ role: 'user', text: 'oi' }],
    responseSchema: ESQUEMA,
    ...extras,
  })
}

function reset(novaFila) {
  recebidos.length = 0
  fila = novaFila
}

const erro503 = {
  status: 503,
  corpo: {
    error: {
      code: 503,
      status: 'UNAVAILABLE',
      message: 'This model is currently experiencing high demand.',
    },
  },
}

const erro400Thinking = {
  status: 400,
  corpo: {
    error: {
      code: 400,
      status: 'INVALID_ARGUMENT',
      message:
        'Invalid JSON payload received. Unknown name "thinkingLevel" at ' +
        "'generation_config': Cannot find field.",
    },
  },
}

// ---------------------------------------------------------------------------
console.log('\n=== thinking: a forma comprovada vai primeiro ===')

reset([respostaOk({ ok: true })])
await chamar({ thinkingLevel: 'low' })

const cfg = recebidos[0]?.corpo?.generationConfig ?? {}
verifica(
  'uma unica chamada quando a primeira variante passa',
  recebidos.length === 1,
  `foram ${recebidos.length}`,
)
verifica(
  'nao manda thinkingLevel no topo do generationConfig',
  cfg.thinkingLevel === undefined,
  `veio ${JSON.stringify(cfg.thinkingLevel)}`,
)
verifica(
  'manda thinkingConfig.thinkingBudget',
  cfg.thinkingConfig?.thinkingBudget === 512,
  JSON.stringify(cfg.thinkingConfig),
)

reset([respostaOk({ ok: true })])
await chamar({ thinkingLevel: 'medium' })
verifica(
  'medium vale mais orcamento que low',
  recebidos[0].corpo.generationConfig.thinkingConfig.thinkingBudget === 2048,
  JSON.stringify(recebidos[0].corpo.generationConfig.thinkingConfig),
)

reset([respostaOk({ ok: true })])
await chamar({})
verifica(
  'sem thinkingLevel nao manda thinkingConfig',
  recebidos[0].corpo.generationConfig.thinkingConfig === undefined,
)

// ---------------------------------------------------------------------------
console.log('\n=== thinking: recuo quando o campo e recusado ===')

reset([erro400Thinking, respostaOk({ ok: true })])
const comRecuo = await chamar({ thinkingLevel: 'low' })
verifica(
  '400 de campo de thinking cai na variante seguinte',
  recebidos.length === 2,
  `foram ${recebidos.length}`,
)
verifica(
  'segunda tentativa usa thinkingConfig.thinkingLevel',
  recebidos[1].corpo.generationConfig.thinkingConfig?.thinkingLevel === 'low',
  JSON.stringify(recebidos[1].corpo.generationConfig.thinkingConfig),
)
verifica('devolve o dado apos o recuo', comRecuo.data.ok === true)

reset([
  {
    status: 400,
    corpo: {
      error: {
        code: 400,
        status: 'INVALID_ARGUMENT',
        message: 'responseSchema invalido',
      },
    },
  },
])
let erroDeSchema = null
await chamar({ thinkingLevel: 'low' }).catch((e) => (erroDeSchema = e))
verifica(
  '400 que nao e de thinking nao insiste',
  recebidos.length === 1,
  `foram ${recebidos.length}`,
)
verifica('400 real vira GeminiError', erroDeSchema instanceof GeminiError)
verifica(
  'resumo do erro carrega o codigo de razao do provedor',
  erroDeSchema?.resumo.includes('INVALID_ARGUMENT'),
  erroDeSchema?.resumo,
)

// ---------------------------------------------------------------------------
console.log('\n=== 503: a falha que derrubou a IA em producao ===')

reset([erro503, erro503, respostaOk({ ok: true })])
const t0 = Date.now()
const apos503 = await chamar({ thinkingLevel: 'low' })
const decorrido = Date.now() - t0

verifica('503 duas vezes e depois 200 chega a responder', apos503.data.ok === true)
verifica('repetiu tres vezes', recebidos.length === 3, `foram ${recebidos.length}`)
verifica('esperou entre as tentativas', decorrido >= 2000, `${decorrido}ms`)

reset([erro503])
let sobrecarga = null
await chamar({ thinkingLevel: 'low' }).catch((e) => (sobrecarga = e))
verifica(
  '503 sem tregua vira GeminiSobrecargaError',
  sobrecarga instanceof GeminiSobrecargaError,
  String(sobrecarga),
)
verifica(
  'desiste em tres tentativas, nao insiste para sempre',
  recebidos.length === 3,
  `foram ${recebidos.length}`,
)
verifica(
  'mensagem diz que e sobrecarga e que passa',
  /sobrecarregado/.test(sobrecarga?.message ?? '') &&
    /segundos/.test(sobrecarga?.message ?? ''),
  sobrecarga?.message,
)

reset([
  {
    status: 429,
    corpo: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota' } },
  },
])
let quota = null
await chamar({}).catch((e) => (quota = e))
verifica('429 tambem e repetido', recebidos.length === 3, `foram ${recebidos.length}`)
verifica(
  '429 esgotado vira GeminiSobrecargaError',
  quota instanceof GeminiSobrecargaError,
)

reset([
  {
    status: 403,
    corpo: {
      error: { code: 403, status: 'PERMISSION_DENIED', message: 'chave invalida' },
    },
  },
])
let negado = null
await chamar({}).catch((e) => (negado = e))
verifica(
  '403 NAO e repetido: chave errada nao melhora esperando',
  recebidos.length === 1,
  `foram ${recebidos.length}`,
)
verifica(
  '403 carrega PERMISSION_DENIED no resumo',
  negado?.resumo?.includes('PERMISSION_DENIED'),
  negado?.resumo,
)

// ---------------------------------------------------------------------------
console.log('\n=== resposta vazia por teto de tokens ===')

const semTexto = {
  status: 200,
  corpo: {
    candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }],
    usageMetadata: {
      promptTokenCount: 100,
      candidatesTokenCount: 0,
      thoughtsTokenCount: 4096,
    },
  },
}

reset([semTexto, respostaOk({ ok: true })])
const recuperado = await chamar({ thinkingLevel: 'low' })
verifica(
  '200 vazio tenta a variante seguinte em vez de morrer',
  recuperado.data.ok === true,
)

reset([semTexto])
let vazio = null
await chamar({ thinkingLevel: 'low' }).catch((e) => (vazio = e))
verifica(
  'vazio em todas as variantes vira GeminiSemSaidaError',
  vazio instanceof GeminiSemSaidaError,
  String(vazio),
)
verifica(
  'a mensagem aponta para o teto, nao para "conteudo vazio"',
  /teto de \d+ tokens/.test(vazio?.message ?? ''),
  vazio?.message,
)
verifica('teto padrao subiu para 4096', /4096/.test(vazio?.message ?? ''), vazio?.message)

// ---------------------------------------------------------------------------
console.log('\n=== payload que o projeto exige ===')

reset([respostaOk({ ok: true })])
await chamar({ systemInstruction: 'seja o mestre' })
const corpo = recebidos[0].corpo
verifica(
  'responseMimeType e JSON quando ha schema',
  corpo.generationConfig.responseMimeType === 'application/json',
)
verifica('cinco categorias de safety', (corpo.safetySettings ?? []).length === 5)
verifica(
  'todas as categorias em OFF',
  corpo.safetySettings.every((s) => s.threshold === 'OFF'),
)
verifica(
  'systemInstruction vai separado dos contents',
  corpo.systemInstruction?.parts?.[0]?.text === 'seja o mestre',
)

// ---------------------------------------------------------------------------
servidor.close()

console.log('\n===================================')
console.log(` ${passou} passaram, ${falhou} falharam`)
console.log('===================================\n')
process.exit(falhou ? 1 : 0)
