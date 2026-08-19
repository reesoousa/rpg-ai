import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { cn } from '@/lib/utils'

export interface Turn {
  id: string
  /** Markdown cru vindo do mestre. E ele que o botao copiar entrega. */
  narrative: string
  /** A acao do jogador que provocou este turno, quando houve uma. */
  playerAction?: { type: 'speak' | 'act' | 'continue'; text?: string }
}

const actionLabel = {
  speak: 'Voce diz',
  act: 'Voce faz',
  continue: 'A cena segue',
} as const

export function TurnBlock({ turn }: { turn: Turn }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(turn.narrative)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <article className="group relative">
      {turn.playerAction && (
        <p className="text-text-muted font-display text-ui-sm mb-3 font-medium">
          <span className="text-accent-text">{actionLabel[turn.playerAction.type]}</span>
          {turn.playerAction.text ? ` — ${turn.playerAction.text}` : ''}
        </p>
      )}

      {/* Prosa corrida, sem bolha. Selecao de texto livre por requisito. */}
      <div
        className={cn(
          'narrative',
          '[&_p]:mb-4 [&_p:last-child]:mb-0',
          '[&_em]:text-text-muted [&_strong]:text-accent-text [&_strong]:font-semibold',
        )}
      >
        <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
          {turn.narrative}
        </Markdown>
      </div>

      <button
        type="button"
        onClick={copy}
        aria-label="Copiar este trecho"
        className={cn(
          'text-text-muted hover:text-text mt-3 inline-flex h-9 items-center gap-1.5',
          'text-ui-sm rounded-full transition-colors duration-150 ease-out',
          // Discreto no toque, aparece no hover no desktop.
          'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100',
        )}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
        {copied ? 'Copiado' : 'Copiar'}
      </button>
    </article>
  )
}
