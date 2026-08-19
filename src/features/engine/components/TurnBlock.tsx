import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { cn } from '@/lib/utils'

/** Formato como o turno vem do banco. */
export interface Turn {
  id?: string
  seq: number
  turn_type: 'speak' | 'act' | 'continue' | 'opening'
  player_input: string | null
  /** Markdown cru do mestre. E isto que o botao copiar entrega. */
  narrative: string
  scene_prompt?: string | null
}

const rotuloDaAcao = {
  speak: 'Voce diz',
  act: 'Voce faz',
  continue: 'A cena segue',
  opening: 'A historia comeca',
} as const

export function TurnBlock({ turn }: { turn: Turn }) {
  const [copiado, setCopiado] = useState(false)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(turn.narrative)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1600)
    } catch {
      // Sem permissao de clipboard: a selecao manual continua funcionando,
      // que e o motivo de nunca desligarmos user-select.
    }
  }

  return (
    <article className="group relative">
      <p className="text-text-muted font-display text-ui-sm mb-3 font-medium">
        <span className="text-accent-text">{rotuloDaAcao[turn.turn_type]}</span>
        {turn.player_input ? ` — ${turn.player_input}` : ''}
      </p>

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
        onClick={copiar}
        aria-label="Copiar este trecho"
        className={cn(
          'text-text-muted hover:text-text mt-3 inline-flex h-9 items-center gap-1.5',
          'text-ui-sm rounded-full transition-colors duration-150 ease-out',
          // Discreto no toque, aparece no hover no desktop.
          'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100',
        )}
      >
        {copiado ? <Check size={15} /> : <Copy size={15} />}
        {copiado ? 'Copiado' : 'Copiar'}
      </button>
    </article>
  )
}
