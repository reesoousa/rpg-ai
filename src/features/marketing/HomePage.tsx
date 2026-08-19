import { Link } from 'react-router'
import { BookOpen, Dices, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ThemeToggle } from '@/components/ThemeToggle'

const features = [
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

export function HomePage() {
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
        <Button variant="subtle" size="lg" className="mt-6">
          Comecar uma campanha
        </Button>
      </section>

      <section className="space-y-4">
        <h2 className="text-title">Como funciona</h2>
        {features.map(({ Icon, title, body }) => (
          <Card key={title}>
            {/* Icone solto, sem box tonal atras (regra 2). */}
            <Icon size={26} strokeWidth={2} className="text-accent-text mb-3" />
            <h3 className="text-ui font-display font-bold">{title}</h3>
            <p className="text-text-muted text-ui mt-1">{body}</p>
          </Card>
        ))}
      </section>

      <section>
        <Link to="/jogar" className="text-accent-text text-ui underline">
          Ver a interface de jogo (placeholder)
        </Link>
      </section>
    </div>
  )
}
