// Contrato de saida do turno.
//
// O responseSchema do Gemini e um subconjunto do OpenAPI 3.0: aceita type,
// enum, properties, required, items, propertyOrdering — mas NAO aceita objeto
// de chaves livres (additionalProperties). Por isso `flags_set` e um array de
// pares e nao um mapa.

export const TURN_RESPONSE_SCHEMA = {
  type: 'object',
  // propertyOrdering deixa a saida estavel entre chamadas, o que ajuda o cache
  // e torna a leitura de log previsivel.
  propertyOrdering: ['narrative', 'state_delta', 'suggested_actions'],
  properties: {
    narrative: {
      type: 'string',
      description:
        'A narracao do turno, em Markdown, em portugues do Brasil. Prosa corrida, ' +
        'segunda pessoa. Sem cabecalhos, sem listas, sem meta-comentario.',
    },
    state_delta: {
      type: 'object',
      propertyOrdering: [
        'hp_change',
        'time_passed_minutes',
        'current_location',
        'location_description',
        'weather',
        'present_npcs',
        'inventory_add',
        'inventory_remove',
        'flags_set',
      ],
      properties: {
        hp_change: {
          type: 'integer',
          description: 'Variacao de HP neste turno. Negativo para dano, positivo para cura, 0 se nada.',
        },
        time_passed_minutes: {
          type: 'integer',
          description: 'Minutos de tempo de jogo decorridos neste turno.',
        },
        current_location: {
          type: 'string',
          description: 'Nome do local ao fim do turno. Omitir se nao mudou.',
        },
        location_description: {
          type: 'string',
          description: 'Uma frase descrevendo o local, se ele mudou.',
        },
        weather: { type: 'string', description: 'Clima, se mudou.' },
        present_npcs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Nomes dos NPCs presentes ao fim do turno. Lista completa, nao incremental.',
        },
        inventory_add: { type: 'array', items: { type: 'string' } },
        inventory_remove: { type: 'array', items: { type: 'string' } },
        flags_set: {
          type: 'array',
          description: 'Consequencias persistentes. Ex: chave "favor_taverneiro", valor "devido".',
          items: {
            type: 'object',
            propertyOrdering: ['key', 'value'],
            properties: {
              key: { type: 'string' },
              value: { type: 'string' },
            },
            required: ['key', 'value'],
          },
        },
      },
      required: ['hp_change', 'time_passed_minutes'],
    },
    suggested_actions: {
      type: 'array',
      description: 'Duas a quatro acoes plausiveis, para os botoes de acao rapida.',
      items: {
        type: 'object',
        propertyOrdering: ['type', 'label'],
        properties: {
          type: { type: 'string', enum: ['speak', 'act'] },
          label: { type: 'string', description: 'Texto curto, no maximo 6 palavras.' },
        },
        required: ['type', 'label'],
      },
    },
  },
  required: ['narrative', 'state_delta'],
} as const

export interface TurnResponse {
  narrative: string
  state_delta: {
    hp_change: number
    time_passed_minutes: number
    current_location?: string
    location_description?: string
    weather?: string
    present_npcs?: string[]
    inventory_add?: string[]
    inventory_remove?: string[]
    flags_set?: Array<{ key: string; value: string }>
  }
  suggested_actions?: Array<{ type: 'speak' | 'act'; label: string }>
}

/** Teto de tempo por turno, para o relogio do mundo nao disparar. */
export const MAX_MINUTES_POR_TURNO = 240

/** Teto de dano/cura por turno, para um delta absurdo nao zerar a ficha. */
export const MAX_HP_DELTA = 50

/**
 * O modelo obedece ao schema, mas nada garante que obedeca ao bom senso: nada
 * o impede de devolver `time_passed_minutes: 100000`. O clamp acontece aqui,
 * antes de o delta tocar o banco.
 */
export function sanitizeDelta(delta: TurnResponse['state_delta']) {
  const clamp = (n: number, limite: number) =>
    Math.max(-limite, Math.min(limite, Math.trunc(n || 0)))

  return {
    ...delta,
    hp_change: clamp(delta.hp_change, MAX_HP_DELTA),
    time_passed_minutes: Math.max(
      0,
      Math.min(MAX_MINUTES_POR_TURNO, Math.trunc(delta.time_passed_minutes || 0)),
    ),
  }
}
