import { useState } from 'react'
import { Navigate } from 'react-router'
import { Check, Mail } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { useAuth } from './useAuth'
import { isSupabaseConfigured } from '@/lib/supabase'

export function LoginPage() {
  const { session, carregando, entrarComEmail } = useAuth()
  const [email, setEmail] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  if (carregando) return <p className="text-text-muted text-ui">Carregando…</p>
  if (session) return <Navigate to="/dashboard" replace />

  if (!isSupabaseConfigured) {
    return (
      <Card>
        <h1 className="text-title mb-2">Configuracao pendente</h1>
        <p className="text-text-muted text-ui">
          Faltam <code className="font-mono">VITE_SUPABASE_URL</code> e{' '}
          <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> no ambiente.
        </p>
      </Card>
    )
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    setEnviando(true)
    try {
      await entrarComEmail(email.trim())
      setEnviado(true)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Nao foi possivel enviar o link.')
    } finally {
      setEnviando(false)
    }
  }

  if (enviado) {
    return (
      <div className="space-y-6">
        <Check size={32} strokeWidth={2} className="text-success" />
        <div>
          <h1 className="text-display mb-2">Link enviado</h1>
          <p className="text-text-muted max-w-md text-ui">
            Abra o email que mandamos para <strong className="text-text">{email}</strong> e
            toque no link. Ele te trouxe de volta para ca, ja conectado.
          </p>
        </div>
        <Button variant="ghost" onClick={() => setEnviado(false)}>
          Usar outro email
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-display-lg">Entrar</h1>
        <p className="text-text-muted mt-2 max-w-md text-ui">
          Sem senha: mandamos um link por email. O acesso e por convite.
        </p>
      </div>

      <form onSubmit={enviar} className="max-w-md space-y-4">
        <div className="bg-surface-sunken rounded-control flex items-center gap-3 px-4">
          <Mail size={18} className="text-text-muted shrink-0" />
          <input
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="seu@email.com"
            aria-label="Seu email"
            className="text-ui placeholder:text-text-muted min-w-0 flex-1 bg-transparent py-4 outline-none"
          />
        </div>

        {erro && (
          <p role="alert" className="text-danger text-ui">
            {erro}
          </p>
        )}

        <Button type="submit" size="lg" disabled={enviando || !email.trim()} className="w-full">
          {enviando ? 'Enviando…' : 'Receber link de acesso'}
        </Button>
      </form>
    </div>
  )
}
