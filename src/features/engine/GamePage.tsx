import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Image as ImageIcon, User } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { getSupabase } from '@/lib/supabase'
import { api, ApiError, type TurnType } from '@/lib/api'
import { base64ParaBlob, guardarCena } from '@/lib/scene-cache'
import { ActionBar } from './components/ActionBar'
import { TurnBlock, type Turn } from './components/TurnBlock'
import { CharacterDrawer, type Ficha, type Mundo } from './components/CharacterDrawer'
import { SceneImage } from './components/SceneImage'

/** Quantos turnos carregar de inicio. Historia longa ganha "carregar anterior". */
const JANELA = 40

interface DadosDoJogo {
  titulo: string
  turnos: Turn[]
  ficha: Ficha | null
  mundo: Mundo | null
}

export function GamePage() {
  const { id: campaignId } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const [fichaAberta, setFichaAberta] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [gerandoCena, setGerandoCena] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [continueStreak, setContinueStreak] = useState(0)
  const fimRef = useRef<HTMLDivElement>(null)

  const jogo = useQuery({
    queryKey: ['jogo', campaignId],
    enabled: Boolean(campaignId),
    queryFn: async (): Promise<DadosDoJogo> => {
      const sb = getSupabase()
      const [camp, turnos, ficha, mundo] = await Promise.all([
        sb.from('campaigns').select('title').eq('id', campaignId!).single(),
        sb
          .from('turns')
          .select('id, seq, turn_type, player_input, narrative, scene_prompt')
          .eq('campaign_id', campaignId!)
          .order('seq', { ascending: false })
          .limit(JANELA),
        sb.from('characters').select('*').eq('campaign_id', campaignId!).single(),
        sb.from('world_state').select('*').eq('campaign_id', campaignId!).single(),
      ])

      if (camp.error) throw camp.error

      return {
        titulo: camp.data.title,
        // Volta a ordem cronologica: a historia se le de cima para baixo.
        turnos: [...(turnos.data ?? [])].reverse() as Turn[],
        ficha: (ficha.data as Ficha) ?? null,
        mundo: (mundo.data as Mundo) ?? null,
      }
    },
  })

  const turnos = jogo.data?.turnos ?? []
  const ultimoSeq = turnos.length ? turnos[turnos.length - 1]!.seq : 0

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turnos.length])

  async function jogar(tipo: TurnType, texto?: string) {
    if (!campaignId || enviando) return
    setEnviando(true)
    setErro(null)
    setContinueStreak((n) => (tipo === 'continue' ? n + 1 : 0))

    try {
      await api.jogarTurno(campaignId, tipo, texto)
      // Recarrega do banco em vez de montar o turno no cliente: o banco e a
      // fonte da verdade do estado, e o delta ja foi aplicado la.
      await qc.invalidateQueries({ queryKey: ['jogo', campaignId] })
      await qc.invalidateQueries({ queryKey: ['quota'] })
    } catch (e) {
      // Turno recusado nao aconteceu: desfaz a contagem local de "continue".
      if (tipo === 'continue') setContinueStreak((n) => Math.max(0, n - 1))
      setErro(e instanceof ApiError ? e.message : 'Falha ao jogar o turno.')
    } finally {
      setEnviando(false)
    }
  }

  async function gerarCena(regenerarSeq?: number) {
    if (!campaignId || gerandoCena) return
    setGerandoCena(true)
    setErro(null)
    try {
      const r = await api.gerarCena(campaignId, regenerarSeq)
      const seq = r.turn_seq ?? ultimoSeq
      // A imagem so existe aqui: guardar antes de qualquer outra coisa.
      await guardarCena(campaignId, seq, {
        blob: base64ParaBlob(r.image_base64, r.mime_type),
        prompt: r.prompt,
        geradaEm: Date.now(),
      })
      await qc.invalidateQueries({ queryKey: ['jogo', campaignId] })
      await qc.invalidateQueries({ queryKey: ['quota'] })
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Falha ao gerar a cena.')
    } finally {
      setGerandoCena(false)
    }
  }

  if (jogo.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="bg-surface-1 h-6 w-48 animate-pulse rounded-full" />
        <div className="bg-surface-1 h-40 animate-pulse rounded-card" />
      </div>
    )
  }

  if (jogo.isError) {
    return (
      <Card>
        <p className="text-danger text-ui">Nao foi possivel abrir esta campanha.</p>
        <Button variant="subtle" size="md" onClick={() => jogo.refetch()} className="mt-4">
          Tentar de novo
        </Button>
      </Card>
    )
  }

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-text-muted truncate font-mono text-ui-sm">
            {jogo.data?.mundo?.current_location ?? '—'}
          </p>
          <h1 className="text-title truncate">{jogo.data?.titulo}</h1>
        </div>
        <Button
          variant="subtle"
          size="md"
          onClick={() => setFichaAberta(true)}
          aria-label="Abrir ficha do personagem"
          className="shrink-0 px-4"
        >
          <User size={18} />
          {jogo.data?.ficha && (
            <span className="font-mono tabular-nums">
              {jogo.data.ficha.hp_current}/{jogo.data.ficha.hp_max}
            </span>
          )}
        </Button>
      </header>

      {/* Historia continua: cada turno nasce abaixo do anterior, sem bolhas. */}
      <div className="space-y-8" aria-live="polite" aria-label="Narrativa da aventura">
        {turnos.map((turno) => (
          <div key={turno.id ?? turno.seq} className="space-y-4">
            <TurnBlock turn={turno} />
            {campaignId && (
              <SceneImage
                campaignId={campaignId}
                seq={turno.seq}
                temPrompt={Boolean(turno.scene_prompt)}
                onRegerar={() => gerarCena(turno.seq)}
                regerando={gerandoCena}
              />
            )}
          </div>
        ))}

        {enviando && (
          <div className="space-y-2" aria-busy="true" aria-label="O mestre esta narrando">
            <div className="bg-surface-1 h-4 w-full animate-pulse rounded-full" />
            <div className="bg-surface-1 h-4 w-5/6 animate-pulse rounded-full" />
            <div className="bg-surface-1 h-4 w-4/6 animate-pulse rounded-full" />
          </div>
        )}
        <div ref={fimRef} />
      </div>

      {erro && (
        <Card>
          <p role="alert" className="text-danger text-ui">
            {erro}
          </p>
        </Card>
      )}

      <div className="space-y-3">
        <Button
          variant="subtle"
          size="md"
          onClick={() => gerarCena()}
          disabled={gerandoCena || enviando || !turnos.length}
          className="w-full"
        >
          <ImageIcon size={18} />
          {gerandoCena ? 'Gerando a cena…' : 'Gerar cena'}
        </Button>

        <ActionBar
          onSubmit={jogar}
          disabled={enviando || gerandoCena}
          continueStreak={continueStreak}
        />
      </div>

      <CharacterDrawer
        ficha={jogo.data?.ficha ?? null}
        mundo={jogo.data?.mundo ?? null}
        aberto={fichaAberta}
        onAbertoChange={setFichaAberta}
      />
    </div>
  )
}
