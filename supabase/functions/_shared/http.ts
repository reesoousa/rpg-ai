// Utilitarios de HTTP compartilhados pelas functions.

import { GeminiBlockedError, GeminiError, GeminiSemSaidaError } from './gemini.ts'

/**
 * Origens permitidas. Em producao o app roda no GitHub Pages; em dev, no Vite.
 * Sem `*`: a function e autenticada e nao ha motivo para aceitar qualquer site.
 */
const ORIGENS_PADRAO = [
  'https://reesoousa.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
]

function origensPermitidas(): string[] {
  const extra = Deno.env.get('CORS_ORIGINS')
  return extra
    ? extra
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : ORIGENS_PADRAO
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  const permitida = origensPermitidas().includes(origin)
  return {
    'access-control-allow-origin': permitida ? origin : origensPermitidas()[0]!,
    'access-control-allow-headers': 'authorization, content-type, apikey',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'origin',
  }
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'content-type': 'application/json' },
  })
}

export function erro(
  req: Request,
  mensagem: string,
  status: number,
  extra?: unknown,
): Response {
  return json(req, { error: mensagem, ...(extra ? { detail: extra } : {}) }, status)
}

export function preflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null
  return new Response(null, { status: 204, headers: corsHeaders(req) })
}

/**
 * Traduz uma falha do modelo em resposta HTTP, com a causa visivel.
 *
 * Antes cada function repetia o mesmo bloco e terminava em `'Falha ao X.'`,
 * jogando a causa real no console. Isso deixava a integracao com a IA
 * indiagnosticavel de fora: qualquer coisa — modelo inexistente, quota
 * estourada, campo rejeitado, resposta vazia — chegava como a mesma frase.
 *
 * O que passa a aparecer e o codigo de razao do provedor (NOT_FOUND,
 * RESOURCE_EXHAUSTED, INVALID_ARGUMENT, PERMISSION_DENIED) e o status HTTP.
 * Nada disso e segredo: sao codigos publicos da API do Google, e a chave nunca
 * aparece no corpo do erro. O payload cru continua indo somente para o log.
 *
 * Devolve `null` quando o erro nao e do modelo, para o `catch` seguir adiante.
 */
export function erroDoModelo(req: Request, e: unknown, acao: string): Response | null {
  if (e instanceof GeminiBlockedError) {
    return erro(
      req,
      `O provedor interrompeu a geracao (${e.finishReason}). Tente reformular.`,
      422,
    )
  }

  if (e instanceof GeminiSemSaidaError) {
    console.error('gemini/sem-saida', e.maxOutputTokens, e.thoughtTokens)
    return erro(req, `Falha ao ${acao}: ${e.message}`, 502)
  }

  if (e instanceof GeminiError) {
    // O detail cru vai so para o log: pode ser um corpo longo.
    console.error('gemini', e.status, e.message, e.detail)
    return erro(req, `Falha ao ${acao}. Provedor: ${e.resumo}`, 502)
  }

  return null
}
