// Stub do Gemini para teste local.
//
// Faz duas coisas: responde no formato de generateContent e VALIDA o payload
// que a Edge Function enviou. Assim conferimos safety settings, responseSchema
// e ordem das partes do prompt sem gastar token nem precisar da chave real.
//
// Uso: node scripts/gemini-stub.mjs [porta]

import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'

const PORTA = Number(process.argv[2] ?? 8899)
const DESTINO_LOG = process.env.STUB_LOG ?? 'stub-last-request.json'

const RESPOSTA_DO_MESTRE = {
  narrative:
    'A mulher fecha o livro e o som seco atravessa o salao. **Ela conhece seu nome** — ' +
    'diz antes que voce pergunte, e a chuva parece esperar pela resposta.\n\n' +
    '*O taverneiro finge nao ouvir.*',
  state_delta: {
    hp_change: -3,
    time_passed_minutes: 12,
    current_location: 'Taverna do Cao Torto',
    location_description: 'Salao apertado, cheiro de cerveja velha e lenha molhada.',
    present_npcs: ['A mulher do fundo', 'Taverneiro'],
    weather: 'chuva forte',
    inventory_add: ['carta selada'],
    inventory_remove: [],
    flags_set: [{ key: 'mulher_sabe_seu_nome', value: 'sim' }],
  },
  suggested_actions: [
    { type: 'speak', label: 'Perguntar quem ela e' },
    { type: 'act', label: 'Levar a mao a arma' },
  ],
}

function validarPayload(body) {
  const problemas = []
  const cfg = body.generationConfig ?? {}

  if (cfg.responseMimeType !== 'application/json') {
    problemas.push(`responseMimeType deveria ser application/json, veio ${cfg.responseMimeType}`)
  }
  if (!cfg.responseSchema) problemas.push('falta responseSchema')
  if (!body.systemInstruction) problemas.push('falta systemInstruction')

  const safety = body.safetySettings ?? []
  if (safety.length < 5) problemas.push(`safetySettings tem ${safety.length} categoria(s), esperava 5`)
  const naoDesligadas = safety.filter((s) => s.threshold !== 'OFF' && s.threshold !== 'BLOCK_NONE')
  if (naoDesligadas.length) {
    problemas.push(`categorias nao liberadas: ${naoDesligadas.map((s) => s.category).join(', ')}`)
  }

  const partes = (body.contents ?? []).map((c) => c.parts?.[0]?.text ?? '')
  if (partes.length !== 3) problemas.push(`esperava 3 partes de conteudo, veio ${partes.length}`)
  // ordem estavel -> volatil, para o cache implicito pegar o prefixo
  if (partes[0] && !partes[0].includes('# sistema.md')) problemas.push('parte 1 deveria ser sistema.md')
  if (partes[1] && !partes[1].includes('# personagem.md')) problemas.push('parte 2 deveria ser personagem.md')
  if (partes[2] && !partes[2].includes('# historico_recente.md')) {
    problemas.push('parte 3 deveria ser historico_recente.md')
  }

  return problemas
}

const servidor = createServer((req, res) => {
  let cru = ''
  req.on('data', (c) => (cru += c))
  req.on('end', () => {
    let body = {}
    try {
      body = JSON.parse(cru)
    } catch {
      /* deixa vazio: a validacao acusa */
    }

    const problemas = validarPayload(body)
    writeFileSync(
      DESTINO_LOG,
      JSON.stringify(
        {
          url: req.url,
          temChave: Boolean(req.headers['x-goog-api-key']),
          problemas,
          body,
        },
        null,
        2,
      ),
    )

    console.log(`[stub] ${req.method} ${req.url}`)
    console.log(`[stub] chave presente: ${Boolean(req.headers['x-goog-api-key'])}`)
    if (problemas.length) {
      console.log('[stub] PROBLEMAS NO PAYLOAD:')
      for (const p of problemas) console.log(`  - ${p}`)
    } else {
      console.log('[stub] payload OK')
    }

    // Simula rejeicao do campo de thinking, para exercitar o fallback.
    if (process.env.STUB_REJEITAR_THINKING === '1' && cru.includes('thinking')) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          error: { code: 400, message: 'Unknown name "thinkingLevel" in GenerationConfig.' },
        }),
      )
      return
    }

    const texto = JSON.stringify(RESPOSTA_DO_MESTRE)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: texto }] }, finishReason: 'STOP' }],
        usageMetadata: {
          promptTokenCount: 3812,
          candidatesTokenCount: 640,
          thoughtsTokenCount: 210,
          cachedContentTokenCount: 2048,
        },
      }),
    )
  })
})

servidor.listen(PORTA, () => console.log(`[stub] ouvindo em http://0.0.0.0:${PORTA}`))
