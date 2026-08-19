import { useQuery } from '@tanstack/react-query'
import { LogOut, Shield } from 'lucide-react'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ThemeToggle } from '@/components/ThemeToggle'
import { getSupabase } from '@/lib/supabase'
import { useAuth } from './useAuth'

interface Quota {
  turns_used: number
  turns_limit: number
  images_used: number
  images_limit: number
}

export function ProfilePage() {
  const { session, role, sair } = useAuth()

  const quota = useQuery({
    queryKey: ['quota', session?.user.id],
    queryFn: async (): Promise<Quota | null> => {
      const { data, error } = await getSupabase().rpc('my_quota_today')
      if (error) throw error
      return (Array.isArray(data) ? data[0] : data) ?? null
    },
  })

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-display">Perfil</h1>
        <p className="text-text-muted mt-1 text-ui">{session?.user.email}</p>
      </header>

      <Card className="space-y-4">
        <h2 className="text-ui font-display font-bold">Uso de hoje</h2>
        {quota.data ? (
          <dl className="font-mono text-data space-y-2">
            <div className="flex justify-between">
              <dt className="text-text-muted">Turnos</dt>
              <dd className="tabular-nums">
                {quota.data.turns_used} / {quota.data.turns_limit}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-muted">Imagens</dt>
              <dd className="tabular-nums">
                {quota.data.images_used} / {quota.data.images_limit}
              </dd>
            </div>
          </dl>
        ) : (
          <div className="bg-surface-sunken h-10 animate-pulse rounded-control" aria-busy="true" />
        )}
        <p className="text-text-muted text-ui-sm">
          O limite existe para conter o custo de IA. Ele zera todo dia.
        </p>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-ui font-display font-bold">Aparencia</h2>
        <ThemeToggle />
      </Card>

      {role === 'master' && (
        <Card>
          <Shield size={26} strokeWidth={2} className="text-accent-text mb-3" />
          <h2 className="text-ui font-display font-bold">Painel do mestre</h2>
          <p className="text-text-muted mt-1 text-ui">
            Cadastrar sistemas, ingerir livros e montar aventuras.
          </p>
          <ButtonLink to="/admin" variant="subtle" size="md" className="mt-4">
            Abrir painel
          </ButtonLink>
        </Card>
      )}

      <Button variant="ghost" size="md" onClick={sair}>
        <LogOut size={17} />
        Sair
      </Button>
    </div>
  )
}
