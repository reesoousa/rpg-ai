import { useQuery } from '@tanstack/react-query'
import { BookOpen, Dices, Sparkles } from 'lucide-react'
import { ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ThemeToggle } from '@/components/ThemeToggle'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'
import { useAuth } from '@/features/auth/useAuth'

const comoFunciona = [
  {
    Icon: Sparkles,
    title: 'Um mestre que nao cansa',
    body: 'Narrativa continua, memoria do mundo e consequencias que persistem entre sessoes.',
  },
  {
    Icon: BookOpen,
    title: 'Seus livros, suas regras',
    body: 'Suba o PDF do sistema e o mestre passa a jogar com ele na mesa.',
  },
  {
    Icon: Dices,
    title: 'Sozinho, quando der vontade',
    body: 'Sem marcar horario com ninguem. A mesa abre quando voce abre o app.',
  },
]

interface ItemDaVitrine {
  id: string
  name: string
  tagline: string | null
  cover_url: string | null
}

interface AventuraDaVitrine {
  id: string
  title: string
  synopsis: string | null
  cover_url: string | null
}

export function HomePage() {
  const { session } = useAuth()

  // A vitrine e a area deslogada: estas leituras passam pela anon key, e a
  // policy so devolve o que esta publicado.
  const sistemas = useQuery({
    queryKey: ['vitrine', 'sistemas'],
    enabled: isSupabaseConfigured,
    queryFn: async (): Promise<ItemDaVitrine[]> => {
      const { data, error } = await getSupabase()
        .from('systems')
        .select('id, name, tagline, cover_url')
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })

  const aventuras = useQuery({
    queryKey: ['vitrine', 'aventuras'],
    enabled: isSupabaseConfigured,
    queryFn: async (): Promise<AventuraDaVitrine[]> => {
      const { data, error } = await getSupabase()
        .from('adventures')
        .select('id, title, synopsis, cover_url')
        .order('title')
      if (error) throw error
      return data ?? []
    },
  })

  return (
    <div className="space-y-10">
      <div className="flex justify-end">
        <ThemeToggle />
      </div>

      {/* Gradiente em uma superficie por tela (regra 4) — esta e a escolhida. */}
      <section className="gradient-accent rounded-card shadow-2 p-6">
        <h1 className="text-display-lg font-display text-white">Sua mesa abre agora.</h1>
        <p className="text-ui mt-3 max-w-md text-white/80">
          RPG de mesa solo com um mestre que lembra de tudo: do nome do taverneiro ao
          favor que voce deve a ele.
        </p>
        <ButtonLink
          to={session ? '/campanha/nova' : '/entrar'}
          variant="subtle"
          size="lg"
          className="mt-6"
        >
          {session ? 'Comecar uma campanha' : 'Entrar para jogar'}
        </ButtonLink>
      </section>

      {/* --- sistemas publicados */}
      {sistemas.data && sistemas.data.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-title">Sistemas disponiveis</h2>
          {sistemas.data.map((s) => (
            <Card key={s.id} className="overflow-hidden p-0">
              {s.cover_url && (
                <img
                  src={s.cover_url}
                  alt={`Capa de ${s.name}`}
                  className="aspect-video w-full object-cover"
                  loading="lazy"
                />
              )}
              <div className="p-5">
                <h3 className="text-title">{s.name}</h3>
                {s.tagline && <p className="text-text-muted mt-1 text-ui">{s.tagline}</p>}
              </div>
            </Card>
          ))}
        </section>
      )}

      {/* --- aventuras publicadas */}
      {aventuras.data && aventuras.data.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-title">Aventuras prontas</h2>
          {aventuras.data.map((a) => (
            <Card key={a.id} className="overflow-hidden p-0">
              {a.cover_url && (
                <img
                  src={a.cover_url}
                  alt={`Capa de ${a.title}`}
                  className="aspect-video w-full object-cover"
                  loading="lazy"
                />
              )}
              <div className="p-5">
                <h3 className="text-title">{a.title}</h3>
                {a.synopsis && <p className="text-text-muted mt-1 text-ui">{a.synopsis}</p>}
              </div>
            </Card>
          ))}
        </section>
      )}

      <section className="space-y-4">
        <h2 className="text-title">Como funciona</h2>
        {comoFunciona.map(({ Icon, title, body }) => (
          <Card key={title}>
            {/* Icone solto, sem box tonal atras (regra 2). */}
            <Icon size={26} strokeWidth={2} className="text-accent-text mb-3" />
            <h3 className="text-ui font-display font-bold">{title}</h3>
            <p className="text-text-muted mt-1 text-ui">{body}</p>
          </Card>
        ))}
      </section>
    </div>
  )
}
