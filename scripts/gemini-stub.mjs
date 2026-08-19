// Stub do Gemini para teste local.
//
// Faz duas coisas: responde no formato da API e VALIDA o payload que a Edge
// Function enviou. Assim conferimos safety settings, responseSchema, ordem das
// partes do prompt e envio de PDF sem gastar token nem usar a chave real.
//
// Reconhece qual function chamou pela forma do responseSchema.
//
// Uso: node scripts/gemini-stub.mjs [porta]

import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'

const PORTA = Number(process.argv[2] ?? 8899)
const DESTINO_LOG = process.env.STUB_LOG ?? 'stub-last-request.json'

// PNG 1x1, o menor arquivo valido possivel.
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

const RESPOSTAS = {
  turno: {
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
  },

  abertura: {
    narrative:
      'A estrada termina onde a neblina comeca. **Tres dias de caminhada** e o que sobrou ' +
      'da sua vida anterior cabe na bolsa que voce carrega.\n\nAlguem esta esperando no ' +
      'portao, e nao parece surpreso de ver voce.',
    location: 'Portao de Vale Cinza',
    location_description: 'Muralha baixa de pedra escura, tochas apagadas pela umidade.',
    weather: 'neblina densa',
    present_npcs: ['Guarda de manto vermelho'],
  },

  wizard: {
    reply:
      'Antes do nome: sua personagem carrega uma divida, uma promessa ou um segredo? ' +
      'Escolha uma e me diga com quem.',
    ready: false,
  },

  wizardPronto: {
    reply: 'Fechado. Sua ficha esta pronta.',
    ready: true,
    character: {
      name: 'Vera Dorn',
      concept: 'Mercenaria que deve um favor a quem nao deveria',
      hp_max: 22,
      attributes: [
        { key: 'forca', value: '3' },
        { key: 'mente', value: '2' },
      ],
      skills: ['Intimidar', 'Furtividade'],
      inventory: ['adaga curta', 'moeda estrangeira'],
    },
  },

  extracao: {
    title: 'O Sino de Vale Cinza',
    synopsis: 'O filho do prefeito desapareceu e o moinho guarda a resposta.',
    plot_digest:
      'A aventura comeca com o desaparecimento do filho do prefeito. Se o jogador nao ' +
      'agir em tres dias, o corpo aparece no rio e a cidade fecha os portoes.',
    entities: [
      {
        kind: 'npc',
        name: 'Prefeito Aldric',
        summary: 'Pai desesperado, esconde que a divida e dele.',
        data: [
          { key: 'atitude', value: 'suplicante' },
          { key: 'segredo', value: 'contraiu a divida no jogo' },
        ],
      },
      {
        kind: 'location',
        name: 'Moinho Abandonado',
        summary: 'Onde o rapaz foi visto por ultimo.',
        data: [{ key: 'saidas', value: 'estrada norte, trilha do rio' }],
      },
      {
        kind: 'item',
        name: 'Anel de sinete quebrado',
        summary: 'Metade encontrada no moinho.',
        data: [],
      },
      {
        kind: 'event',
        name: 'O corpo no rio',
        summary: 'Acontece no terceiro dia.',
        data: [],
      },
    ],
  },

  digest: {
    digest:
      'Resolucao por 2d6 mais atributo. 7 a 9 e sucesso com custo, 10 ou mais e sucesso ' +
      'limpo, 6 ou menos o Mestre decide a complicacao. Dano e fixo por arma e reduz ' +
      'Pontos de Vida. A zero, o personagem cai e faz um teste de morte.',
    system_name: 'Sistema de Teste',
    dice_notation: '2d6',
  },
}

function identificar(body) {
  const props = body?.generationConfig?.responseSchema?.properties ?? {}
  if (props.reply) return 'wizard'
  if (props.plot_digest) return 'extracao'
  if (props.digest) return 'digest'
  if (props.state_delta) return 'turno'
  if (props.narrative && props.location) return 'abertura'
  return 'turno'
}

function validar(body, tipo) {
  const problemas = []
  const cfg = body.generationConfig ?? {}

  if (cfg.responseMimeType !== 'application/json') {
    problemas.push(
      `responseMimeType deveria ser application/json, veio ${cfg.responseMimeType}`,
    )
  }
  if (!cfg.responseSchema) problemas.push('falta responseSchema')
  if (!body.systemInstruction) problemas.push('falta systemInstruction')

  const safety = body.safetySettings ?? []
  if (safety.length < 5) problemas.push(`safetySettings tem ${safety.length}, esperava 5`)
  const ligadas = safety.filter(
    (s) => s.threshold !== 'OFF' && s.threshold !== 'BLOCK_NONE',
  )
  if (ligadas.length) {
    problemas.push(
      `categorias nao liberadas: ${ligadas.map((s) => s.category).join(', ')}`,
    )
  }

  const conteudos = body.contents ?? []
  if (tipo === 'turno') {
    const t = conteudos.map((c) => c.parts?.[0]?.text ?? '')
    if (t.length !== 3) problemas.push(`turno esperava 3 partes, veio ${t.length}`)
    if (t[0] && !t[0].includes('# sistema.md'))
      problemas.push('parte 1 deveria ser sistema.md')
    if (t[1] && !t[1].includes('# personagem.md'))
      problemas.push('parte 2 deveria ser personagem.md')
    if (t[2] && !t[2].includes('# historico_recente.md')) {
      problemas.push('parte 3 deveria ser historico_recente.md')
    }
  }

  if (tipo === 'digest') {
    const partes = conteudos.flatMap((c) => c.parts ?? [])
    const pdf = partes.find((p) => p.inlineData?.mimeType === 'application/pdf')
    if (!pdf)
      problemas.push('ingestao deveria enviar PDF como inlineData application/pdf')
    else if (!pdf.inlineData.data?.length) problemas.push('PDF enviado sem dados base64')
  }

  if (tipo === 'extracao') {
    // A extracao aceita texto OU PDF. Quando vem inlineData, o unico mimeType
    // valido e PDF: qualquer outro seria bug de montagem do payload.
    const inline = conteudos.flatMap((c) => c.parts ?? []).filter((p) => p.inlineData)
    for (const p of inline) {
      if (p.inlineData.mimeType !== 'application/pdf') {
        problemas.push(
          `extracao enviou inlineData ${p.inlineData.mimeType}, esperava PDF`,
        )
      }
      if (!p.inlineData.data?.length) problemas.push('PDF da aventura sem dados base64')
    }
  }

  return problemas
}

function responderTexto(req, res, cru) {
  let body = {}
  try {
    body = JSON.parse(cru)
  } catch {
    /* validacao acusa */
  }

  const tipo = identificar(body)
  const problemas = validar(body, tipo)

  writeFileSync(
    DESTINO_LOG,
    JSON.stringify(
      {
        url: req.url,
        tipo,
        temChave: Boolean(req.headers['x-goog-api-key']),
        problemas,
        body,
      },
      null,
      2,
    ),
  )

  console.log(`[stub] ${req.method} ${req.url} -> ${tipo}`)
  if (problemas.length) {
    console.log('[stub] PROBLEMAS:')
    for (const p of problemas) console.log(`  - ${p}`)
  } else {
    console.log('[stub] payload OK')
  }

  if (process.env.STUB_REJEITAR_THINKING === '1' && cru.includes('thinking')) {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        error: {
          code: 400,
          message: 'Unknown name "thinkingLevel" in GenerationConfig.',
        },
      }),
    )
    return
  }

  let dados = RESPOSTAS[tipo]
  // Permite testar o wizard fechando a ficha.
  if (tipo === 'wizard' && process.env.STUB_WIZARD_PRONTO === '1') {
    dados = RESPOSTAS.wizardPronto
  }

  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(
    JSON.stringify({
      candidates: [
        { content: { parts: [{ text: JSON.stringify(dados) }] }, finishReason: 'STOP' },
      ],
      usageMetadata: {
        promptTokenCount: 3812,
        candidatesTokenCount: 640,
        thoughtsTokenCount: 210,
        cachedContentTokenCount: 2048,
      },
    }),
  )
}

function responderImagem(req, res, cru) {
  let body = {}
  try {
    body = JSON.parse(cru)
  } catch {
    /* ignora */
  }

  const problemas = []
  if (!body.model) problemas.push('falta model')
  if (!Array.isArray(body.input) || !body.input[0]?.text)
    problemas.push('falta input com texto')
  if (body.response_format?.type !== 'image')
    problemas.push('response_format.type deveria ser image')

  writeFileSync(
    DESTINO_LOG,
    JSON.stringify(
      {
        url: req.url,
        tipo: 'imagem',
        temChave: Boolean(req.headers['x-goog-api-key']),
        problemas,
        body,
      },
      null,
      2,
    ),
  )

  console.log(`[stub] ${req.method} ${req.url} -> imagem`)
  if (problemas.length) for (const p of problemas) console.log(`  - ${p}`)
  else console.log('[stub] payload de imagem OK')

  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(
    JSON.stringify({
      output_image: { type: 'image', mime_type: 'image/png', data: PNG_1X1 },
    }),
  )
}

const servidor = createServer((req, res) => {
  let cru = ''
  req.on('data', (c) => (cru += c))
  req.on('end', () => {
    if (req.url?.includes('/interactions')) responderImagem(req, res, cru)
    else responderTexto(req, res, cru)
  })
})

servidor.listen(PORTA, () => console.log(`[stub] ouvindo em http://0.0.0.0:${PORTA}`))
