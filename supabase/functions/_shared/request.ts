// Boilerplate comum a toda function: autenticacao, clientes e quota.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export interface Contexto {
  userId: string
  /** Herda o JWT do chamador: RLS vale. Use para tudo que o usuario pode ler. */
  comoUsuario: SupabaseClient
  /** Privilegiado. Use apenas para o que o cliente nao pode fazer por design. */
  comoServico: SupabaseClient
}

export class RespostaDeErro extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra?: unknown,
  ) {
    super(message)
  }
}

export async function autenticar(req: Request): Promise<Contexto> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) throw new RespostaDeErro(401, 'Falta o header Authorization.')

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const comoUsuario = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const comoServico = createClient(url, serviceKey)

  const { data, error } = await comoUsuario.auth.getUser()
  if (error || !data?.user) throw new RespostaDeErro(401, 'Sessao invalida.')

  return { userId: data.user.id, comoUsuario, comoServico }
}

/** Confere o papel de mestre no servidor. Guard de rota no cliente e so UX. */
export async function exigirMestre(ctx: Contexto): Promise<void> {
  const { data, error } = await ctx.comoUsuario
    .from('profiles')
    .select('role')
    .eq('id', ctx.userId)
    .single()

  if (error || data?.role !== 'master') {
    throw new RespostaDeErro(403, 'Esta area e restrita ao mestre.')
  }
}

export type TipoDeQuota = 'turn' | 'image'

/**
 * Reserva uma unidade de quota. Retorna o quanto resta e uma funcao de
 * devolucao, para o caso de a chamada ao modelo falhar depois.
 */
export async function reservarQuota(
  ctx: Contexto,
  tipo: TipoDeQuota,
): Promise<{ restante: number; devolver: () => Promise<void> }> {
  const consumir = tipo === 'turn' ? 'consume_turn_quota' : 'consume_image_quota'
  const devolverRpc = tipo === 'turn' ? 'refund_turn_quota' : 'refund_image_quota'

  const { data, error } = await ctx.comoServico.rpc(consumir, { p_user: ctx.userId })

  if (error) {
    if (/Limite diario/.test(error.message)) throw new RespostaDeErro(429, error.message)
    throw new RespostaDeErro(500, 'Falha ao verificar quota.', error.message)
  }

  return {
    restante: data as number,
    devolver: async () => {
      await ctx.comoServico.rpc(devolverRpc, { p_user: ctx.userId })
    },
  }
}

export async function lerJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    throw new RespostaDeErro(400, 'Corpo nao e JSON valido.')
  }
}

export function exigirTexto(valor: unknown, campo: string, max = 2000): string {
  if (typeof valor !== 'string' || !valor.trim()) {
    throw new RespostaDeErro(400, `${campo} e obrigatorio.`)
  }
  if (valor.length > max) {
    throw new RespostaDeErro(400, `${campo} longo demais (max ${max} caracteres).`)
  }
  return valor.trim()
}
