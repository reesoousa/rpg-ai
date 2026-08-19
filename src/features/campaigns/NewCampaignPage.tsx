import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { getSupabase } from '@/lib/supabase'
import { api, ApiError, type RespostaDoWizard } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Sistema {
  id: string
  name: string
  tagline: string | null
}

type Mensagem = { role: 'user' | 'model'; text: string }

export function NewCampaignPage() {
  const navegar = useNavigate()
  const [sistemaId, setSistemaId] = useState<string | null>(null)
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
        .select('id, name, tagline')
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [mensagens, ficha])

  /**
   * O id do sistema vem por parametro, nao do state.
   *
   * setState e assincrono: chamar isto logo depois de setSistemaId leria o
   * valor do render anterior (null) e a funcao sairia calada, sem nunca
   * disparar a requisicao.
   */
  async function chamarWizard(historico: Mensagem[], idDoSistema: string) {
    setPensando(true)
    setErro(null)
    try {
      const r = await api.wizard(idDoSistema, historico)
      setMensagens([...historico, { role: 'model', text: r.reply }])
      if (r.ready && r.character) {
        setFicha(r.character)
        setTitulo((t) => t || `A historia de ${r.character!.name}`)
      }
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Falha ao falar com o assistente.')
    } finally {
      setPensando(false)
    }
  }

  function escolherSistema(id: string) {
    setSistemaId(id)
    void chamarWizard([], id)
  }

  function enviar() {
    const texto = entrada.trim()
    if (!texto || pensando || !sistemaId) return
    setEntrada('')
    void chamarWizard([...mensagens, { role: 'user', text: texto }], sistemaId)
  }

  async function abrirCampanha() {
    if (!ficha || !sistemaId) return
    setAbrindo(true)
    setErro(null)
    try {
      const r = await api.abrirCampanha({
        system_id: sistemaId,
        title: titulo.trim() || `A historia de ${ficha.name}`,
        character: ficha,
      })
      navegar(`/campanha/${r.campaign_id}/jogar`, { replace: true })
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Falha ao abrir a campanha.')
      setAbrindo(false)
    }
  }

  // --- passo 1: escolher o sistema
  if (!sistemaId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-display">Nova campanha</h1>
          <p className="text-text-muted mt-2 text-ui">
            Escolha o sistema. Depois o assistente monta o personagem com voce.
          </p>
        </div>

        {sistemas.isPending && (
          <div className="bg-surface-1 rounded-card h-20 animate-pulse" aria-busy="true" />
        )}

        {sistemas.data?.length === 0 && (
          <Card>
            <p className="text-text-muted text-ui">
              Nenhum sistema publicado ainda. O painel do mestre precisa cadastrar um.
            </p>
          </Card>
        )}

        <div className="space-y-3">
          {sistemas.data?.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => escolherSistema(s.id)}
              className="block w-full text-left"
            >
              <Card className="hover:bg-surface-2 transition-colors duration-150 ease-out">
                <h2 className="text-title">{s.name}</h2>
                {s.tagline && <p className="text-text-muted mt-1 text-ui">{s.tagline}</p>}
              </Card>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // --- passo 2: o chat do wizard
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-title">Criando seu personagem</h1>
        <p className="text-text-muted mt-1 text-ui-sm">
          O assistente decide os numeros. Voce so descreve quem e.
        </p>
      </header>

      <div className="space-y-5" aria-live="polite">
        {mensagens.map((m, i) => (
          <div
            key={i}
            className={cn(
              'text-ui',
              m.role === 'model' ? 'text-text' : 'text-text-muted',
            )}
          >
            {m.role === 'user' && <span className="text-accent-text">Voce: </span>}
            {m.text}
          </div>
        ))}
        {pensando && (
          <div className="bg-surface-1 h-5 w-40 animate-pulse rounded-full" aria-busy="true" />
        )}
        <div ref={fimRef} />
      </div>

      {erro && (
        <p role="alert" className="text-danger text-ui">
          {erro}
        </p>
      )}

      {/* --- ficha pronta: confirma e abre */}
      {ficha ? (
        <Card className="space-y-4">
          <div>
            <Sparkles size={24} strokeWidth={2} className="text-accent-text mb-2" />
            <h2 className="text-title">{ficha.name}</h2>
            <p className="text-text-muted mt-1 text-ui">{ficha.concept}</p>
          </div>

          <dl className="font-mono text-ui-sm space-y-1">
            <div className="flex justify-between">
              <dt className="text-text-muted">HP</dt>
              <dd>{ficha.hp_max}</dd>
            </div>
            {ficha.attributes?.map((a) => (
              <div key={a.key} className="flex justify-between">
                <dt className="text-text-muted">{a.key}</dt>
                <dd>{a.value}</dd>
              </div>
            ))}
          </dl>

          {(ficha.skills?.length || ficha.inventory?.length) && (
            <div className="text-ui space-y-1">
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
              onChange={(e) => setTitulo(e.target.value)}
              aria-label="Nome da campanha"
              placeholder="Nome da campanha"
              className="text-ui placeholder:text-text-muted w-full bg-transparent py-3 outline-none"
            />
          </div>

          <Button size="lg" onClick={abrirCampanha} disabled={abrindo} className="w-full">
            {abrindo ? 'Abrindo a cena…' : 'Abrir campanha'}
          </Button>
          <Button
            variant="ghost"
            size="md"
            onClick={() => setFicha(null)}
            disabled={abrindo}
            className="w-full"
          >
            Continuar ajustando
          </Button>
        </Card>
      ) : (
        <div className="bg-surface-sunken rounded-control flex items-center gap-2 p-2">
          <input
            value={entrada}
            onChange={(e) => setEntrada(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                enviar()
              }
            }}
            disabled={pensando}
            placeholder="Responda…"
            aria-label="Sua resposta ao assistente"
            className="text-ui placeholder:text-text-muted min-w-0 flex-1 bg-transparent px-3 py-2 outline-none"
          />
          <Button
            size="md"
            onClick={enviar}
            disabled={pensando || !entrada.trim()}
            aria-label="Enviar"
            className="px-4"
          >
            <ArrowRight size={18} />
          </Button>
        </div>
      )}
    </div>
  )
}
