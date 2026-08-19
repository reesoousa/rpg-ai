import * as Dialog from '@radix-ui/react-dialog'
import { Heart, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Ficha {
  name: string
  concept: string | null
  level: number
  hp_current: number
  hp_max: number
  attributes: Record<string, unknown>
  skills: unknown[]
  inventory: unknown[]
}

export interface Mundo {
  current_location: string | null
  present_npcs: unknown[]
  weather: string | null
  world_clock: string
}

function listar(valor: unknown[]): string[] {
  return valor
    .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
    .filter((v) => v && v !== '{}')
}

function horaDoMundo(iso: string): string {
  // UTC de proposito: e a hora do mundo do jogo, nao a do jogador.
  const d = new Date(iso)
  return `${d.toISOString().slice(11, 16)} · dia ${d.toISOString().slice(0, 10)}`
}

/**
 * Radix em vez de drawer caseiro: ele resolve foco preso, Esc, scroll travado e
 * aria — coisas que um `div` com transform nao faz e que quebram no leitor de
 * tela. A camada visual continua nossa.
 */
export function CharacterDrawer({
  ficha,
  mundo,
  aberto,
  onAbertoChange,
}: {
  ficha: Ficha | null
  mundo: Mundo | null
  aberto: boolean
  onAbertoChange: (v: boolean) => void
}) {
  const pctVida = ficha ? Math.round((ficha.hp_current / ficha.hp_max) * 100) : 0
  const ferido = pctVida <= 33

  return (
    <Dialog.Root open={aberto} onOpenChange={onAbertoChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          className={cn(
            'bg-surface-2 rounded-sheet fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto',
            'p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2',
            'sm:inset-y-0 sm:right-0 sm:left-auto sm:w-96 sm:max-h-none sm:rounded-none',
          )}
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-title">{ficha?.name ?? 'Ficha'}</Dialog.Title>
              {ficha?.concept && (
                <Dialog.Description className="text-text-muted mt-1 text-ui">
                  {ficha.concept}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close
              aria-label="Fechar ficha"
              className="text-text-muted hover:text-text -mr-1 -mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-full"
            >
              <X size={20} />
            </Dialog.Close>
          </div>

          {ficha && (
            <div className="space-y-6">
              {/* Vida: cor NAO e o unico sinal — icone e numero acompanham. */}
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-ui">
                    <Heart
                      size={17}
                      className={ferido ? 'text-danger' : 'text-success'}
                      fill={ferido ? 'currentColor' : 'none'}
                    />
                    Vida
                  </span>
                  <span className="font-mono text-data tabular-nums">
                    {ficha.hp_current}/{ficha.hp_max}
                  </span>
                </div>
                <div className="bg-surface-sunken h-2 overflow-hidden rounded-full">
                  <div
                    className={cn(
                      'h-full rounded-full transition-[width] duration-200 ease-out',
                      ferido ? 'bg-danger' : 'bg-success',
                    )}
                    style={{ width: `${pctVida}%` }}
                    role="progressbar"
                    aria-valuenow={ficha.hp_current}
                    aria-valuemin={0}
                    aria-valuemax={ficha.hp_max}
                    aria-label="Pontos de vida"
                  />
                </div>
              </section>

              {Object.keys(ficha.attributes ?? {}).length > 0 && (
                <section>
                  <h3 className="text-text-muted font-display mb-2 text-ui-sm font-medium uppercase">
                    Atributos
                  </h3>
                  <dl className="font-mono text-data space-y-1">
                    {Object.entries(ficha.attributes).map(([k, v]) => (
                      <div key={k} className="flex justify-between">
                        <dt className="text-text-muted">{k}</dt>
                        <dd className="tabular-nums">{String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}

              {listar(ficha.skills ?? []).length > 0 && (
                <section>
                  <h3 className="text-text-muted font-display mb-2 text-ui-sm font-medium uppercase">
                    Pericias
                  </h3>
                  <p className="text-ui">{listar(ficha.skills).join(', ')}</p>
                </section>
              )}

              <section>
                <h3 className="text-text-muted font-display mb-2 text-ui-sm font-medium uppercase">
                  Inventario
                </h3>
                {listar(ficha.inventory ?? []).length ? (
                  <ul className="text-ui space-y-1">
                    {listar(ficha.inventory).map((item) => (
                      <li key={item} className="flex gap-2">
                        <span className="text-text-muted font-mono">—</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-text-muted text-ui">Nada.</p>
                )}
              </section>

              {mundo && (
                <section>
                  <h3 className="text-text-muted font-display mb-2 text-ui-sm font-medium uppercase">
                    Mundo
                  </h3>
                  <dl className="text-ui space-y-1">
                    <div>
                      <dt className="text-text-muted inline">Local: </dt>
                      <dd className="inline">{mundo.current_location ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-text-muted inline">Clima: </dt>
                      <dd className="inline">{mundo.weather ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-text-muted inline">Presentes: </dt>
                      <dd className="inline">
                        {listar(mundo.present_npcs ?? []).join(', ') || 'ninguem'}
                      </dd>
                    </div>
                    <div className="pt-1 font-mono text-data">
                      <dt className="text-text-muted inline">Relogio: </dt>
                      <dd className="inline tabular-nums">{horaDoMundo(mundo.world_clock)}</dd>
                    </div>
                  </dl>
                </section>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
