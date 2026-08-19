// Schemas de saida estruturada das functions que nao sao o turno de jogo.
//
// Lembrete do subconjunto aceito pelo Gemini: sem objeto de chaves livres.
// Todo mapa vira array de pares.

const PAR_CHAVE_VALOR = {
  type: 'object',
  propertyOrdering: ['key', 'value'],
  properties: { key: { type: 'string' }, value: { type: 'string' } },
  required: ['key', 'value'],
} as const

// ---------------------------------------------------------------------------
// Wizard de personagem
// ---------------------------------------------------------------------------
export const WIZARD_SCHEMA = {
  type: 'object',
  propertyOrdering: ['reply', 'ready', 'character'],
  properties: {
    reply: {
      type: 'string',
      description:
        'Sua proxima mensagem ao jogador, em portugues do Brasil. Uma pergunta por vez, ' +
        'com no maximo 60 palavras. Sugira opcoes quando ajudar a decidir.',
    },
    ready: {
      type: 'boolean',
      description: 'true somente quando houver dados suficientes para fechar a ficha.',
    },
    character: {
      type: 'object',
      description: 'Preencher apenas quando ready for true.',
      propertyOrdering: [
        'name',
        'concept',
        'hp_max',
        'attributes',
        'skills',
        'inventory',
      ],
      properties: {
        name: { type: 'string' },
        concept: { type: 'string', description: 'Uma linha: quem e e o que quer.' },
        hp_max: { type: 'integer' },
        attributes: { type: 'array', items: PAR_CHAVE_VALOR },
        skills: { type: 'array', items: { type: 'string' } },
        inventory: { type: 'array', items: { type: 'string' } },
      },
      required: ['name', 'concept', 'hp_max'],
    },
  },
  required: ['reply', 'ready'],
} as const

export interface WizardResponse {
  reply: string
  ready: boolean
  character?: {
    name: string
    concept: string
    hp_max: number
    attributes?: Array<{ key: string; value: string }>
    skills?: string[]
    inventory?: string[]
  }
}

// ---------------------------------------------------------------------------
// Turno de abertura
// ---------------------------------------------------------------------------
export const ABERTURA_SCHEMA = {
  type: 'object',
  propertyOrdering: [
    'narrative',
    'location',
    'location_description',
    'weather',
    'present_npcs',
  ],
  properties: {
    narrative: {
      type: 'string',
      description:
        'A cena de abertura em Markdown, portugues do Brasil, segunda pessoa. ' +
        'Entre 150 e 300 palavras. Termine em um momento que peca acao.',
    },
    location: { type: 'string' },
    location_description: { type: 'string' },
    weather: { type: 'string' },
    present_npcs: { type: 'array', items: { type: 'string' } },
  },
  required: ['narrative', 'location'],
} as const

export interface AberturaResponse {
  narrative: string
  location: string
  location_description?: string
  weather?: string
  present_npcs?: string[]
}

// ---------------------------------------------------------------------------
// Fabrica de campanhas: texto solto -> JSON estrito
// ---------------------------------------------------------------------------
export const EXTRACAO_SCHEMA = {
  type: 'object',
  propertyOrdering: ['title', 'synopsis', 'plot_digest', 'entities'],
  properties: {
    // Extraindo de PDF, o mestre nao digitou nada: titulo e sinopse vem do
    // proprio documento. Com texto colado ele ja tem os dois e a function
    // preserva o que estiver preenchido.
    title: {
      type: 'string',
      description: 'Titulo da aventura como aparece no documento.',
    },
    synopsis: {
      type: 'string',
      description:
        'Sinopse curta para vitrine, de duas a tres frases, sem revelar reviravolta.',
    },
    plot_digest: {
      type: 'string',
      description:
        'Resumo operacional da aventura para o mestre: premissa, ganchos, o que acontece ' +
        'se o jogador nao agir. Entre 200 e 500 palavras.',
    },
    entities: {
      type: 'array',
      items: {
        type: 'object',
        propertyOrdering: ['kind', 'name', 'summary', 'data'],
        properties: {
          kind: {
            type: 'string',
            enum: ['location', 'npc', 'item', 'faction', 'event'],
          },
          name: { type: 'string' },
          summary: { type: 'string', description: 'Uma ou duas frases.' },
          data: {
            type: 'array',
            description:
              'Detalhes variaveis por tipo. NPC: atitude, objetivo, segredo. ' +
              'Local: saidas, perigo. Item: efeito, dono.',
            items: PAR_CHAVE_VALOR,
          },
        },
        required: ['kind', 'name', 'summary'],
      },
    },
  },
  required: ['plot_digest', 'entities'],
} as const

export interface ExtracaoResponse {
  title?: string
  synopsis?: string
  plot_digest: string
  entities: Array<{
    kind: 'location' | 'npc' | 'item' | 'faction' | 'event'
    name: string
    summary: string
    data?: Array<{ key: string; value: string }>
  }>
}

// ---------------------------------------------------------------------------
// Ingestao de livro de regras
// ---------------------------------------------------------------------------
export const DIGEST_SCHEMA = {
  type: 'object',
  propertyOrdering: ['digest', 'system_name', 'dice_notation'],
  properties: {
    digest: {
      type: 'string',
      description:
        'Resumo OPERACIONAL das regras: o que o mestre precisa para narrar e resolver ' +
        'acoes. Como se rola, como se resolve conflito, como funciona dano e cura, ' +
        'recursos do personagem, condicoes. Entre 400 e 1200 palavras. Nao copie o ' +
        'texto do livro; escreva instrucoes de uso.',
    },
    system_name: { type: 'string' },
    dice_notation: { type: 'string', description: 'Ex: 2d6, d20, dados de pool.' },
  },
  required: ['digest'],
} as const

export interface DigestResponse {
  digest: string
  system_name?: string
  dice_notation?: string
}

/** Converte array de pares no objeto que o banco guarda. */
export function paresParaObjeto(
  pares?: Array<{ key: string; value: string }>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const { key, value } of pares ?? []) {
    if (key) out[key] = value
  }
  return out
}
