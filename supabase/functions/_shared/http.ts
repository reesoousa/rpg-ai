// Utilitarios de HTTP compartilhados pelas functions.

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
  return extra ? extra.split(',').map((o) => o.trim()).filter(Boolean) : ORIGENS_PADRAO
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

export function erro(req: Request, mensagem: string, status: number, extra?: unknown): Response {
  return json(req, { error: mensagem, ...(extra ? { detail: extra } : {}) }, status)
}

export function preflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null
  return new Response(null, { status: 204, headers: corsHeaders(req) })
}
