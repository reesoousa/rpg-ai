// Criacao de campanha, em quatro passos e em tela cheia.
//
// Era uma pagina dentro do AppShell que fazia duas coisas numa: escolher o
// sistema e conversar com o wizard. Dois problemas praticos disso:
//
// 1. A aventura nunca aparecia. A `start-campaign` aceita `adventure_id` desde
//    o inicio, mas a tela so oferecia o sistema — nao havia como comecar uma
//    aventura pronta, so campanha livre.
// 2. O chat do wizard dividia espaco com a nav flutuante e a largura de
//    leitura da vitrine. Montar ficha e uma tarefa de foco: merece a tela.
//
// Por isso esta rota fica FORA do AppShell (ver app/router.tsx) e desenha o
// proprio cabecalho, corpo e rodape.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Check, Compass, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { getSupabase } from '@/lib/supabase'
import { api, ApiError, type RespostaDoWizard } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Sistema {
  id: string
  name: string
  tagline: string | null
  cover_url: string | null
}

interface Aventura {
  id: string
  title: string
  synopsis: string | null
  cover_url: string | null
  is_published: boolean
}

type Mensagem = { role: 'user' | 'model'; text: string }

const PASSOS = ['sistema', 'aventura', 'personagem', 'confirmar'] as const
type Passo = (typeof PASSOS)[number]

const ROTULOS: Record<Passo, string> = {
  sistema: 'Sistema',
  aventura: 'Aventura',
  personagem: 'Personagem',
  confirmar: 'Confirmar',
}

export function NewCampaignPage() {
  const navegar = useNavigate()
  const [passo, setPasso] = useState<Passo>('sistema')

  const [sistema, setSistema] = useState<Sistema | null>(null)
  // `undefined` = ainda nao decidiu. `null` = escolheu campanha livre.
  const [aventura, setAventura] = useState<Aventura | null | undefined>(undefined)

  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [entrada, setEntrada] = useState('')
  const [pensando, setPensando] = useState(false)
  const [ficha, setFicha] = useState<RespostaDoWizard['character']>(null)

  const [titulo, setTitulo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [abrindo, setAbrindo] = useState(false)
  const fimRef = useRef<HTMLDivElement>(null)

  const sistemas = useQuery({
    queryKey: ['sistemas'],
    queryFn: async (): Promise<Sistema[]> => {
      const { data, error } = await getSupabase()
        .from('systems')
        .select('id, name, tagline, cover_url')
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })

  /**
   * Aventuras do sistema escolhido.
   *
   * Sem filtro de `is_published` no cliente: a policy ja esconde rascunho de
   * quem nao e mestre, e para o mestre ver o proprio rascunho aqui e util —
   * da para testar a aventura antes de publicar. O rotulo abaixo diz qual e.
   */
  const aventuras = useQuery({
    queryKey: ['aventuras', sistema?.id],
    enabled: Boolean(sistema?.id),
    queryFn: async (): Promise<Aventura[]> => {
      const { data, error } = await getSupabase()
        .from('adventures')
        .select('id, title, synopsis, cover_url, is_published')
        .eq('system_id', sistema!.id)
        .order('title')
      if (error) throw error
      return data ?? []
    },
  })

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [mensagens, pensando])

  /**
   * O id do sistema vem por parametro, nao do state.
   *
   * setState e assincrono: chamar isto logo depois de escolher leria o valor do
   * render anterior (null) e a funcao sairia calada, sem disparar a requisicao.
   */
  async function chamarWizard(historico: Mensagem[], idDoSistema: string) {
    setPensando(true)
    setErro(null)
    try {
      const r = await api.wizard(idDoSistema, historico)
      setMensagens([...historico, { role: 'model', text: r.reply }])
      if (r.ready && r.character) {
        setFicha(r.character)
        setTitulo((t) => t || tituloPadrao(r.character!.name))
        setPasso('confirmar')
      }
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Falha ao falar com o assistente.')
    } finally {
      setPensando(false)
    }
  }

  function tituloPadrao(nome: string): string {
    return aventura ? `${aventura.title} — ${nome}` : `A historia de ${nome}`
  }

  function irParaPersonagem() {
    setPasso('personagem')
    // Só abre a conversa na primeira vez: voltar e avancar de novo nao deve
    // gastar uma chamada e nem reiniciar a ficha.
    if (!mensagens.length && sistema) void chamarWizard([], sistema.id)
  }

  function enviar() {
    const texto = entrada.trim()
    if (!texto || pensando || !sistema) return
    setEntrada('')
    void chamarWizard([...mensagens, { role: 'user', text: texto }], sistema.id)
  }

  function voltar() {
    setErro(null)
    const i = PASSOS.indexOf(passo)
    if (i <= 0) {
      navegar('/dashboard')
      return
    }
    setPasso(PASSOS[i - 1]!)
  }

  async function abrirCampanha() {
    if (!ficha || !sistema) return
    setAbrindo(true)
    setErro(null)
    try {
      const r = await api.abrirCampanha({
        system_id: sistema.id,
        adventure_id: aventura?.id ?? null,
        title: titulo.trim() || tituloPadrao(ficha.name),
        character: ficha,
      })
      navegar(`/campanha/${r.campaign_id}/jogar`, { replace: true })
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Falha ao abrir a campanha.')
      setAbrindo(false)
    }
  }

  const indice = PASSOS.indexOf(passo)

  return (
    <div className="bg-bg flex min-h-dvh flex-col">
      {/* ---------------------------------------------------------------- topo */}
      <header className="shrink-0 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3">
          <button
            type="button"
            onClick={voltar}
            aria-label={indice === 0 ? 'Sair' : 'Voltar ao passo anterior'}
            className={cn(
              'bg-surface-1 hover:bg-surface-2 shadow-1',
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
              'transition-colors duration-150 ease-out',
            )}
          >
            {indice === 0 ? <X size={18} /> : <ArrowLeft size={18} />}
          </button>

          <div className="min-w-0 flex-1">
            <p className="text-text-muted text-ui-sm font-mono">
              passo {indice + 1} de {PASSOS.length}
            </p>
            <h1 className="text-title truncate">{ROTULOS[passo]}</h1>
          </div>
        </div>

        {/* Trilha de progresso: preenchimento solido, sem contorno (regra 1). */}
        <div className="mx-auto mt-4 flex w-full max-w-2xl gap-1.5" aria-hidden="true">
          {PASSOS.map((p, i) => (
            <div
              key={p}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors duration-300 ease-out',
                i <= indice ? 'bg-primary' : 'bg-surface-sunken',
              )}
            />
          ))}
        </div>
      </header>

      {/* --------------------------------------------------------------- corpo */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto w-full max-w-2xl">
          {passo === 'sistema' && (
            <PassoSistema
              carregando={sistemas.isPending}
              sistemas={sistemas.data ?? []}
              escolhido={sistema}
              onEscolher={(s) => {
                // Trocar de sistema invalida aventura e ficha: as duas
                // dependem das regras dele.
                if (s.id !== sistema?.id) {
                  setAventura(undefined)
                  setMensagens([])
                  setFicha(null)
                }
                setSistema(s)
                setPasso('aventura')
              }}
            />
          )}

          {passo === 'aventura' && sistema && (
            <PassoAventura
              carregando={aventuras.isPending}
              aventuras={aventuras.data ?? []}
              escolhida={aventura}
              onEscolher={(a) => {
                setAventura(a)
                setTitulo('')
              }}
            />
          )}

          {passo === 'personagem' && (
            <PassoPersonagem
              mensagens={mensagens}
              pensando={pensando}
              entrada={entrada}
              onEntrada={setEntrada}
              onEnviar={enviar}
              fimRef={fimRef}
            />
          )}

          {passo === 'confirmar' && ficha && (
            <PassoConfirmar
              ficha={ficha}
              sistema={sistema}
              aventura={aventura ?? null}
              titulo={titulo}
              onTitulo={setTitulo}
              onAjustar={() => {
                setFicha(null)
                setPasso('personagem')
              }}
            />
          )}

          {erro && (
            <p role="alert" className="text-danger text-ui mt-6">
              {erro}
            </p>
          )}
        </div>
      </div>

      {/* -------------------------------------------------------------- rodape */}
      <footer className="shrink-0 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-2xl">
          {passo === 'aventura' && (
            <Button
              size="lg"
              onClick={irParaPersonagem}
              disabled={aventura === undefined}
              className="w-full"
            >
              {aventura === undefined
                ? 'Escolha uma aventura'
                : aventura === null
                  ? 'Seguir sem aventura'
                  : `Jogar ${aventura.title}`}
              <ArrowRight size={18} />
            </Button>
          )}

          {passo === 'confirmar' && (
            <Button
              size="lg"
              onClick={abrirCampanha}
              disabled={abrindo}
              className="w-full"
            >
              {abrindo ? 'Abrindo a cena…' : 'Abrir campanha'}
            </Button>
          )}
        </div>
      </footer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Passo 1: sistema
// ---------------------------------------------------------------------------
function PassoSistema({
  carregando,
  sistemas,
  escolhido,
  onEscolher,
}: {
  carregando: boolean
  sistemas: Sistema[]
  escolhido: Sistema | null
  onEscolher: (s: Sistema) => void
}) {
  return (
    <div className="space-y-4">
      <p className="text-text-muted text-ui">
        O sistema define as regras que o Mestre usa para resolver o que voce faz.
      </p>

      {carregando && <Esqueleto />}

      {!carregando && !sistemas.length && (
        <div className="bg-surface-1 rounded-card shadow-1 p-5">
          <p className="text-ui">Nenhum sistema publicado ainda.</p>
          <p className="text-text-muted text-ui-sm mt-1">
            O painel do mestre precisa cadastrar e publicar um.
          </p>
        </div>
      )}

      {sistemas.map((s) => (
        <Escolha
          key={s.id}
          titulo={s.name}
          descricao={s.tagline}
          capa={s.cover_url}
          selecionado={escolhido?.id === s.id}
          onClick={() => onEscolher(s)}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Passo 2: aventura
//
// A opcao "campanha livre" vem primeiro e explicita. Antes ela era o unico
// caminho possivel, sem o jogador saber que era uma escolha.
// ---------------------------------------------------------------------------
function PassoAventura({
  carregando,
  aventuras,
  escolhida,
  onEscolher,
}: {
  carregando: boolean
  aventuras: Aventura[]
  escolhida: Aventura | null | undefined
  onEscolher: (a: Aventura | null) => void
}) {
  return (
    <div className="space-y-4">
      <p className="text-text-muted text-ui">
        Uma aventura pronta da ao Mestre lugares, pessoas e uma trama para seguir. Sem
        ela, o mundo nasce do seu personagem.
      </p>

      <Escolha
        titulo="Campanha livre"
        descricao="Sem roteiro. O Mestre inventa o mundo a partir de quem voce e."
        icone={<Compass size={22} strokeWidth={2} className="text-accent-text" />}
        selecionado={escolhida === null}
        onClick={() => onEscolher(null)}
      />

      {carregando && <Esqueleto />}

      {!carregando && !aventuras.length && (
        <p className="text-text-muted text-ui-sm">
          Este sistema ainda nao tem aventura publicada.
        </p>
      )}

      {aventuras.map((a) => (
        <Escolha
          key={a.id}
          titulo={a.title}
          descricao={a.synopsis}
          capa={a.cover_url}
          etiqueta={a.is_published ? undefined : 'rascunho'}
          selecionado={escolhida?.id === a.id}
          onClick={() => onEscolher(a)}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Passo 3: o wizard
// ---------------------------------------------------------------------------
function PassoPersonagem({
  mensagens,
  pensando,
  entrada,
  onEntrada,
  onEnviar,
  fimRef,
}: {
  mensagens: Mensagem[]
  pensando: boolean
  entrada: string
  onEntrada: (v: string) => void
  onEnviar: () => void
  fimRef: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <div className="space-y-6">
      <p className="text-text-muted text-ui">
        Descreva quem e o personagem. O assistente decide os numeros.
      </p>

      <div className="space-y-5" aria-live="polite">
        {mensagens.map((m, i) => (
          <div
            key={i}
            className={cn(
              'text-narrative',
              m.role === 'model' ? 'text-text' : 'text-text-muted',
            )}
          >
            {m.role === 'user' && (
              <span className="text-accent-text text-ui-sm font-mono">voce · </span>
            )}
            {m.text}
          </div>
        ))}

        {pensando && (
          <div className="space-y-2" aria-busy="true">
            <div className="bg-surface-1 h-4 w-full animate-pulse rounded-full" />
            <div className="bg-surface-1 h-4 w-4/6 animate-pulse rounded-full" />
          </div>
        )}
        <div ref={fimRef} />
      </div>

      <div className="bg-surface-sunken rounded-control flex items-center gap-2 p-2">
        <input
          value={entrada}
          onChange={(e) => onEntrada(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onEnviar()
            }
          }}
          disabled={pensando}
          placeholder="Responda…"
          aria-label="Sua resposta ao assistente"
          className="text-ui placeholder:text-text-muted min-w-0 flex-1 bg-transparent px-3 py-2 outline-none"
        />
        <Button
          size="md"
          onClick={onEnviar}
          disabled={pensando || !entrada.trim()}
          aria-label="Enviar"
          className="px-4"
        >
          <ArrowRight size={18} />
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Passo 4: confirmar
// ---------------------------------------------------------------------------
function PassoConfirmar({
  ficha,
  sistema,
  aventura,
  titulo,
  onTitulo,
  onAjustar,
}: {
  ficha: NonNullable<RespostaDoWizard['character']>
  sistema: Sistema | null
  aventura: Aventura | null
  titulo: string
  onTitulo: (v: string) => void
  onAjustar: () => void
}) {
  const linhas = useMemo(
    () => [
      { rotulo: 'Sistema', valor: sistema?.name ?? '—' },
      { rotulo: 'Aventura', valor: aventura?.title ?? 'campanha livre' },
      { rotulo: 'HP', valor: String(ficha.hp_max) },
      ...(ficha.attributes ?? []).map((a) => ({ rotulo: a.key, valor: a.value })),
    ],
    [sistema, aventura, ficha],
  )

  return (
    <div className="space-y-6">
      <div>
        <Sparkles size={24} strokeWidth={2} className="text-accent-text mb-3" />
        <h2 className="text-display">{ficha.name}</h2>
        <p className="text-text-muted text-ui mt-2">{ficha.concept}</p>
      </div>

      <dl className="bg-surface-1 rounded-card shadow-1 text-ui-sm divide-y divide-transparent p-5 font-mono">
        {linhas.map((l) => (
          <div key={l.rotulo} className="flex justify-between gap-4 py-1.5">
            <dt className="text-text-muted">{l.rotulo}</dt>
            <dd className="text-right">{l.valor}</dd>
          </div>
        ))}
      </dl>

      {(ficha.skills?.length || ficha.inventory?.length) && (
        <div className="text-ui space-y-2">
          {ficha.skills?.length ? (
            <p>
              <span className="text-text-muted">Pericias: </span>
              {ficha.skills.join(', ')}
            </p>
          ) : null}
          {ficha.inventory?.length ? (
            <p>
              <span className="text-text-muted">Inventario: </span>
              {ficha.inventory.join(', ')}
            </p>
          ) : null}
        </div>
      )}

      <div className="bg-surface-sunken rounded-control px-4">
        <input
          value={titulo}
          onChange={(e) => onTitulo(e.target.value)}
          aria-label="Nome da campanha"
          placeholder="Nome da campanha"
          className="text-ui placeholder:text-text-muted w-full bg-transparent py-3 outline-none"
        />
      </div>

      <Button variant="ghost" size="md" onClick={onAjustar} className="w-full">
        Continuar ajustando o personagem
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Peca de escolha, usada nos passos 1 e 2.
//
// O estado selecionado vem de superficie mais clara e de um marcador solido,
// nunca de contorno (regra 1 do DESIGN.md). O icone, quando existe, fica solto
// e nao dentro de box tonal (regra 2).
// ---------------------------------------------------------------------------
function Escolha({
  titulo,
  descricao,
  capa,
  icone,
  etiqueta,
  selecionado,
  onClick,
}: {
  titulo: string
  descricao?: string | null
  capa?: string | null
  icone?: React.ReactNode
  etiqueta?: string
  selecionado: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selecionado}
      className={cn(
        'rounded-card shadow-1 block w-full p-5 text-left',
        'transition-colors duration-150 ease-out',
        selecionado ? 'bg-surface-2' : 'bg-surface-1 hover:bg-surface-2',
      )}
    >
      <div className="flex items-start gap-4">
        {capa ? (
          <img
            src={capa}
            alt=""
            className="rounded-control h-16 w-24 shrink-0 object-cover"
          />
        ) : (
          icone && <div className="shrink-0 pt-0.5">{icone}</div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-title truncate">{titulo}</h2>
            {etiqueta && (
              <span className="text-warning text-ui-sm shrink-0 font-mono">
                {etiqueta}
              </span>
            )}
          </div>
          {descricao && <p className="text-text-muted text-ui mt-1">{descricao}</p>}
        </div>

        {selecionado && (
          <div className="bg-primary text-on-primary flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
            <Check size={16} strokeWidth={3} />
          </div>
        )}
      </div>
    </button>
  )
}

function Esqueleto() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="bg-surface-1 rounded-card h-24 animate-pulse" />
      <div className="bg-surface-1 rounded-card h-24 animate-pulse" />
    </div>
  )
}
