import { useState } from 'react'
import { cn } from '@/lib/utils'
import { SystemsPanel } from './SystemsPanel'
import { AdventuresPanel } from './AdventuresPanel'
import { RulebooksPanel } from './RulebooksPanel'

const ABAS = [
  { id: 'sistemas', label: 'Sistemas' },
  { id: 'aventuras', label: 'Aventuras' },
  { id: 'livros', label: 'Livros' },
] as const

type Aba = (typeof ABAS)[number]['id']

export function AdminPage() {
  const [aba, setAba] = useState<Aba>('sistemas')

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-display">Painel do mestre</h1>
        <p className="text-text-muted mt-1 text-ui">
          O que voce publica aqui aparece na vitrine e fica disponivel para jogar.
        </p>
      </header>

      {/* Aba ativa e pill solido, nao box tonal (regra 2). */}
      <div
        role="tablist"
        aria-label="Secoes do painel"
        className="bg-surface-sunken flex gap-1 rounded-full p-1"
      >
        {ABAS.map((a) => (
          <button
            key={a.id}
            role="tab"
            aria-selected={aba === a.id}
            onClick={() => setAba(a.id)}
            className={cn(
              'font-display h-11 flex-1 rounded-full text-ui font-medium',
              'transition-colors duration-150 ease-out',
              aba === a.id ? 'bg-primary text-on-primary' : 'text-text-muted hover:text-text',
            )}
          >
            {a.label}
          </button>
        ))}
      </div>

      {aba === 'sistemas' && <SystemsPanel />}
      {aba === 'aventuras' && <AdventuresPanel />}
      {aba === 'livros' && <RulebooksPanel />}
    </div>
  )
}
