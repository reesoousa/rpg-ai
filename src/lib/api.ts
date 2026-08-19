import { getSupabase } from './supabase'

/**
 * Chamadas as Edge Functions.
 *
 * Erro da function chega como JSON { error }. Repassar isso ao usuario importa:
 * "Limite diario de 40 turnos atingido" e uma informacao util, enquanto
 * "erro 429" nao e.
 */
export class ApiError extends Error {
  // Campos declarados fora do construtor: `erasableSyntaxOnly` (tsconfig)
  // proibe parameter properties, porque elas nao existem em JS puro.
  status: number
  detail?: unknown

  constructor(status: number, message: string, detail?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

async function invocar<T>(nome: string, body: unknown): Promise<T> {
  const supabase = getSupabase()
  const { data: sessao } = await supabase.auth.getSession()
  const token = sessao.session?.access_token
  if (!token) throw new ApiError(401, 'Sua sessao expirou. Entre de novo.')

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${nome}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const texto = await res.text()
  let payload: unknown = null
  try {
    payload = texto ? JSON.parse(texto) : null
  } catch {
    payload = texto
  }

  if (!res.ok) {
    const msg =
      (payload as { error?: string })?.error ?? `A chamada falhou (${res.status}).`
    throw new ApiError(res.status, msg, payload)
  }

  return payload as T
}

// ---------------------------------------------------------------------------
// Tipos das respostas
// ---------------------------------------------------------------------------
export type TurnType = 'speak' | 'act' | 'continue'

export interface StateDelta {
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

export interface RespostaDeTurno {
  seq: number
  narrative: string
  state_delta: StateDelta
  suggested_actions: Array<{ type: 'speak' | 'act'; label: string }>
  character: { hp_current: number; hp_max: number }
  world_clock: string
  quota: { turns_remaining: number }
}

export interface RespostaDeAbertura {
  campaign_id: string
  seq: number
  narrative: string
  location: string
  quota: { turns_remaining: number }
}

export interface RespostaDoWizard {
  reply: string
  ready: boolean
  character: {
    name: string
    concept: string
    hp_max: number
    attributes?: Array<{ key: string; value: string }>
    skills?: string[]
    inventory?: string[]
  } | null
  quota: { turns_remaining: number }
}

export interface RespostaDeCena {
  turn_seq: number | null
  prompt: string
  mime_type: string
  image_base64: string
  size_bytes: number
  regenerated: boolean
  quota: { images_remaining: number }
}

// ---------------------------------------------------------------------------
export const api = {
  jogarTurno: (campaignId: string, tipo: TurnType, texto?: string) =>
    invocar<RespostaDeTurno>('play-turn', {
      campaign_id: campaignId,
      turn_type: tipo,
      ...(texto ? { player_input: texto } : {}),
    }),

  abrirCampanha: (dados: {
    system_id: string
    adventure_id?: string | null
    title: string
    character: {
      name: string
      concept: string
      hp_max: number
      attributes?: Array<{ key: string; value: string }>
      skills?: string[]
      inventory?: string[]
    }
  }) => invocar<RespostaDeAbertura>('start-campaign', dados),

  wizard: (systemId: string, mensagens: Array<{ role: 'user' | 'model'; text: string }>) =>
    invocar<RespostaDoWizard>('character-wizard', {
      system_id: systemId,
      messages: mensagens,
    }),

  gerarCena: (campaignId: string, regenerarSeq?: number) =>
    invocar<RespostaDeCena>('generate-scene', {
      campaign_id: campaignId,
      ...(regenerarSeq !== undefined ? { regenerate_turn_seq: regenerarSeq } : {}),
    }),
}
