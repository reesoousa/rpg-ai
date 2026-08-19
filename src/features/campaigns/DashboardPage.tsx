import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Dices, Plus } from 'lucide-react'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { getSupabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/useAuth'

interface Campanha {
  id: string
  title: string
  status: string
  last_turn_seq: number
  updated_at: string
  systems: { name: string } | null
}

interface Quota {
  turns_used: number
  turns_limit: number
  turns_remaining: number
  images_remaining: number
}

function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
  })
}

export function DashboardPage() {
  const { session } = useAuth()

  const campanhas = useQuery({
    queryKey: ['campanhas', session?.user.id],
    queryFn: async (): Promise<Campanha[]> => {
      const { data, error } = await getSupabase()
        .from('campaigns')
        .select('id, title, status, last_turn_seq, updated_at, systems(name)')
        .order('updated_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as Campanha[]
    },
  })

  const quota = useQuery({
    queryKey: ['quota', session?.user.id],
    queryFn: async (): Promise<Quota | null> => {
      const { data, error } = await getSupabase().rpc('my_quota_today')
      if (error) throw error
      return (Array.isArray(data) ? data[0] : data) ?? null
    },
  })

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-display">Suas campanhas</h1>
          {quota.data && (
            <p className="text-text-muted mt-1 font-mono text-ui-sm">
              {quota.data.turns_remaining} de {quota.data.turns_limit} turnos hoje
            </p>
          )}
        </div>
        <ButtonLink to="/campanha/nova" variant="gradient" size="md">
          <Plus size={18} />
          Nova
        </ButtonLink>
      </header>

      {campanhas.isPending && (
        <div className="space-y-3" aria-busy="true">
          <div className="bg-surface-1 rounded-card h-24 animate-pulse" />
          <div className="bg-surface-1 rounded-card h-24 animate-pulse" />
        </div>
      )}

      {campanhas.isError && (
        <Card>
          <p className="text-danger text-ui">
            Nao foi possivel carregar suas campanhas.
          </p>
          <Button variant="subtle" size="md" onClick={() => campanhas.refetch()} className="mt-4">
            Tentar de novo
          </Button>
        </Card>
      )}

      {campanhas.data?.length === 0 && (
        <Card>
          <Dices size={26} strokeWidth={2} className="text-accent-text mb-3" />
          <h2 className="text-ui font-display font-bold">Nenhuma campanha ainda</h2>
          <p className="text-text-muted mt-1 text-ui">
            Crie a primeira: o assistente ajuda a montar o personagem e o mestre abre a
            cena.
          </p>
          <ButtonLink to="/campanha/nova" variant="gradient" size="lg" className="mt-5 w-full">
            Comecar
          </ButtonLink>
        </Card>
      )}

      <div className="space-y-3">
        {campanhas.data?.map((c) => (
          <Link key={c.id} to={`/campanha/${c.id}/jogar`} className="block">
            <Card className="transition-colors duration-150 ease-out hover:bg-surface-2">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-title">{c.title}</h2>
                <span className="text-text-muted shrink-0 font-mono text-ui-sm">
                  {formatarData(c.updated_at)}
                </span>
              </div>
              <p className="text-text-muted mt-1 text-ui">
                {c.systems?.name ?? 'Sistema removido'} · {c.last_turn_seq}{' '}
                {c.last_turn_seq === 1 ? 'turno' : 'turnos'}
                {c.status !== 'active' && ` · ${c.status}`}
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
