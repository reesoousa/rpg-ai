import { useEffect, useRef, useState } from 'react'
import { ActionBar, type TurnType } from './components/ActionBar'
import { TurnBlock, type Turn } from './components/TurnBlock'

const OPENING: Turn = {
  id: 'seed',
  narrative:
    'A chuva bate no telhado de zinco enquanto voce empurra a porta. Dentro, o ' +
    'calor de doze corpos e o cheiro de cerveja velha. Ninguem levanta os olhos — ' +
    'exceto **a mulher no fundo**, que fecha o livro devagar e espera.\n\n' +
    '*O relogio do salao marca dez e quarenta.*',
}

/**
 * Placeholder da engine. O stream, o acumulo e o copiavel ja sao os definitivos;
 * a chamada ao mestre entra quando a Edge Function existir.
 */
export function GamePage() {
  const [turns, setTurns] = useState<Turn[]>([OPENING])
  const [continueStreak, setContinueStreak] = useState(0)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns])

  function handleSubmit(type: TurnType, text?: string) {
    setContinueStreak((n) => (type === 'continue' ? n + 1 : 0))
    setTurns((prev) => [
      ...prev,
      {
        id: `turn-${prev.length}`,
        playerAction: { type, ...(text ? { text } : {}) },
        narrative:
          '_(Aqui entra a resposta do mestre. A Edge Function do Gemini ainda ' +
          'nao esta ligada.)_',
      },
    ])
  }

  return (
    <div className="space-y-8">
      <header>
        <p className="text-text-muted text-ui-sm font-mono">Taverna do Cao Torto</p>
        <h1 className="text-title">A mulher que esperava</h1>
      </header>

      {/* Historia continua: o novo turno nasce abaixo do anterior. */}
      <div className="space-y-8" aria-live="polite" aria-label="Narrativa da aventura">
        {turns.map((turn) => (
          <TurnBlock key={turn.id} turn={turn} />
        ))}
        <div ref={endRef} />
      </div>

      <ActionBar onSubmit={handleSubmit} continueStreak={continueStreak} />
    </div>
  )
}
