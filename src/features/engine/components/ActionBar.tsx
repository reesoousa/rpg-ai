import { useState } from 'react'
import { ArrowRight, MessageSquare, Play, Zap } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

export type TurnType = 'speak' | 'act' | 'continue'

export interface Sugestao {
  type: 'speak' | 'act'
  label: string
}

interface ActionBarProps {
  onSubmit: (type: TurnType, text?: string) => void
  disabled?: boolean
  /** Quantos `continue` seguidos ja aconteceram. */
  continueStreak: number
  /**
   * Acoes plausiveis para este turno, vindas do modelo.
   *
   * A function ja devolvia isto desde o inicio e a barra ignorava — o jogador
   * encarava um campo de texto vazio a cada turno, sem pista do que o mundo
   * permite. Sao atalhos, nao um menu: digitar continua sendo o caminho
   * principal.
   */
  sugestoes?: Sugestao[]
}

/** Depois disso, pedir confirmacao: o botao e barato de apertar, a chamada nao. */
const CONTINUE_STREAK_LIMIT = 3

export function ActionBar({
  onSubmit,
  disabled,
  continueStreak,
  sugestoes = [],
}: ActionBarProps) {
  const [mode, setMode] = useState<Exclude<TurnType, 'continue'>>('act')
  const [text, setText] = useState('')
  const [confirmingContinue, setConfirmingContinue] = useState(false)

  function submitText() {
    const trimmed = text.trim()
    if (!trimmed) return
    onSubmit(mode, trimmed)
    setText('')
  }

  function handleContinue() {
    if (continueStreak >= CONTINUE_STREAK_LIMIT && !confirmingContinue) {
      setConfirmingContinue(true)
      return
    }
    setConfirmingContinue(false)
    onSubmit('continue')
  }

  return (
    <div className="space-y-3">
      {/* Sugestoes acima dos modos: entram como atalho para o campo de texto,
          nao como um quarto botao de comando. */}
      {sugestoes.length > 0 && !disabled && (
        <div className="flex flex-wrap gap-2" aria-label="Acoes sugeridas">
          {sugestoes.map((s, i) => (
            <button
              key={`${s.type}-${i}`}
              type="button"
              onClick={() => {
                setMode(s.type)
                onSubmit(s.type, s.label)
              }}
              className={cn(
                'bg-surface-1 hover:bg-surface-2 shadow-1 rounded-full',
                'text-ui-sm px-4 py-2 text-left',
                'transition-colors duration-150 ease-out',
              )}
            >
              <span className="text-text-muted font-mono">
                {s.type === 'speak' ? 'dizer' : 'fazer'}
              </span>{' '}
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Button
          variant={mode === 'speak' ? 'primary' : 'subtle'}
          size="lg"
          onClick={() => setMode('speak')}
          aria-pressed={mode === 'speak'}
        >
          <MessageSquare size={18} />
          Falar
        </Button>
        <Button
          variant={mode === 'act' ? 'primary' : 'subtle'}
          size="lg"
          onClick={() => setMode('act')}
          aria-pressed={mode === 'act'}
        >
          <Zap size={18} />
          Fazer
        </Button>
        <Button variant="subtle" size="lg" onClick={handleContinue} disabled={disabled}>
          <Play size={18} />
          Continuar
        </Button>
      </div>

      {confirmingContinue && (
        <div className="bg-surface-1 rounded-card shadow-1 p-4">
          <p className="text-ui mb-3">
            Foram {continueStreak} turnos seguidos sem sua interferencia. Deixar a
            historia seguir sozinha de novo?
          </p>
          <div className="flex gap-2">
            <Button
              size="md"
              onClick={() => {
                setConfirmingContinue(false)
                onSubmit('continue')
              }}
            >
              Seguir
            </Button>
            <Button
              variant="ghost"
              size="md"
              onClick={() => setConfirmingContinue(false)}
            >
              Prefiro agir
            </Button>
          </div>
        </div>
      )}

      <div className="bg-surface-sunken rounded-control flex items-center gap-2 p-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submitText()
            }
          }}
          disabled={disabled}
          placeholder={mode === 'speak' ? 'O que voce diz?' : 'O que voce faz?'}
          aria-label={mode === 'speak' ? 'Fala do personagem' : 'Acao do personagem'}
          className="text-ui placeholder:text-text-muted min-w-0 flex-1 bg-transparent px-3 py-2 outline-none"
        />
        <Button
          size="md"
          onClick={submitText}
          disabled={disabled || !text.trim()}
          aria-label="Enviar"
          className="px-4"
        >
          <ArrowRight size={18} />
        </Button>
      </div>
    </div>
  )
}
