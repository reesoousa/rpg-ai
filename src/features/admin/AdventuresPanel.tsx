import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Plus, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { getSupabase } from '@/lib/supabase'
import { apagarCapa } from '@/lib/storage'
import { api, ApiError, type RespostaDeExtracao } from '@/lib/api'
import { CoverUpload } from './CoverUpload'
import { paraSlug } from './SystemsPanel'

interface Aventura {
  id: string
  system_id: string
  slug: string
  title: string
  synopsis: string | null
  cover_url: string | null
  cover_path: string | null
  is_published: boolean
}

export function AdventuresPanel() {
  const qc = useQueryClient()
  const [editando, setEditando] = useState<string | null>(null)
  const [titulo, setTitulo] = useState('')
  const [sistemaId, setSistemaId] = useState('')
  const [textoFonte, setTextoFonte] = useState<Record<string, string>>({})
  const [resultado, setResultado] = useState<Record<string, RespostaDeExtracao>>({})
  const [erro, setErro] = useState<string | null>(null)

  const sistemas = useQuery({
    queryKey: ['admin', 'sistemas', 'simples'],
    queryFn: async () => {
      const { data, error } = await getSupabase().from('systems').select('id, name').order('name')
      if (error) throw error
      return data ?? []
    },
  })

  const aventuras = useQuery({
    queryKey: ['admin', 'aventuras'],
    queryFn: async (): Promise<Aventura[]> => {
      const { data, error } = await getSupabase()
        .from('adventures')
        .select('id, system_id, slug, title, synopsis, cover_url, cover_path, is_published')
        .order('title')
      if (error) throw error
      return data ?? []
    },
  })

  const criar = useMutation({
    mutationFn: async () => {
      const { data, error } = await getSupabase()
        .from('adventures')
        .insert({
          system_id: sistemaId,
          title: titulo.trim(),
          slug: paraSlug(titulo),
          is_published: false,
        })
        .select('id')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (nova) => {
      setTitulo('')
      setEditando(nova.id)
      void qc.invalidateQueries({ queryKey: ['admin', 'aventuras'] })
    },
    onError: (e) => setErro(e instanceof Error ? e.message : 'Falha ao criar.'),
  })

  const salvar = useMutation({
    mutationFn: async ({ id, campos }: { id: string; campos: Partial<Aventura> }) => {
      const { error } = await getSupabase().from('adventures').update(campos).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'aventuras'] }),
    onError: (e) => setErro(e instanceof Error ? e.message : 'Falha ao salvar.'),
  })

  const extrair = useMutation({
    mutationFn: async (id: string) => api.extrairAventura(id, textoFonte[id]),
    onSuccess: (r) => {
      setResultado((atual) => ({ ...atual, [r.adventure_id]: r }))
      void qc.invalidateQueries({ queryKey: ['admin', 'aventuras'] })
    },
    onError: (e) => setErro(e instanceof ApiError ? e.message : 'Falha na extracao.'),
  })

  return (
    <div className="space-y-4">
      <h2 className="text-title">Aventuras</h2>

      {erro && (
        <p role="alert" className="text-danger text-ui">
          {erro}
        </p>
      )}

      <Card className="space-y-3">
        <h3 className="text-ui font-display font-bold">Nova aventura</h3>
        <div className="bg-surface-sunken rounded-control px-4">
          <select
            value={sistemaId}
            onChange={(e) => setSistemaId(e.target.value)}
            aria-label="Sistema da aventura"
            className="text-ui w-full bg-transparent py-3 outline-none"
          >
            <option value="">Escolha o sistema…</option>
            {sistemas.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="bg-surface-sunken rounded-control px-4">
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Titulo da aventura"
            aria-label="Titulo da aventura"
            className="text-ui placeholder:text-text-muted w-full bg-transparent py-3 outline-none"
          />
        </div>
        <Button
          size="md"
          onClick={() => criar.mutate()}
          disabled={!titulo.trim() || !sistemaId || criar.isPending}
        >
          <Plus size={17} />
          {criar.isPending ? 'Criando…' : 'Criar'}
        </Button>
      </Card>

      {aventuras.data?.map((a) => (
        <Card key={a.id} className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-title truncate">{a.title}</h3>
              <p className="text-text-muted font-mono text-ui-sm">{a.slug}</p>
            </div>
            <Button
              variant={a.is_published ? 'primary' : 'subtle'}
              size="md"
              onClick={() => salvar.mutate({ id: a.id, campos: { is_published: !a.is_published } })}
              className="shrink-0 px-4"
            >
              {a.is_published ? <Eye size={17} /> : <EyeOff size={17} />}
              {a.is_published ? 'No ar' : 'Rascunho'}
            </Button>
          </div>

          {editando === a.id ? (
            <div className="space-y-4">
              <CoverUpload
                prefixo={`adventures/${a.id}`}
                urlAtual={a.cover_url}
                pathAtual={a.cover_path}
                onEnviada={(capa) =>
                  salvar.mutate({
                    id: a.id,
                    campos: { cover_url: capa.url, cover_path: capa.path },
                  })
                }
                onRemovida={async () => {
                  if (a.cover_path) await apagarCapa(a.cover_path).catch(() => {})
                  salvar.mutate({ id: a.id, campos: { cover_url: null, cover_path: null } })
                }}
              />

              <div className="bg-surface-sunken rounded-control px-4">
                <textarea
                  defaultValue={a.synopsis ?? ''}
                  onBlur={(e) => salvar.mutate({ id: a.id, campos: { synopsis: e.target.value } })}
                  rows={3}
                  placeholder="Sinopse (aparece na vitrine)"
                  aria-label="Sinopse"
                  className="text-ui placeholder:text-text-muted w-full resize-y bg-transparent py-3 outline-none"
                />
              </div>

              {/* --- fabrica de campanhas */}
              <div className="space-y-3">
                <h4 className="text-ui font-display font-bold">Fabrica de campanhas</h4>
                <p className="text-text-muted text-ui-sm">
                  Cole o texto da aventura. O modelo extrai locais, NPCs, itens, faccoes e
                  eventos para tabelas.
                </p>
                <div className="bg-surface-sunken rounded-control px-4">
                  <textarea
                    value={textoFonte[a.id] ?? ''}
                    onChange={(e) =>
                      setTextoFonte((t) => ({ ...t, [a.id]: e.target.value }))
                    }
                    rows={8}
                    placeholder="Texto ou resumo da aventura…"
                    aria-label="Texto de origem da aventura"
                    className="text-ui placeholder:text-text-muted w-full resize-y bg-transparent py-3 font-mono text-ui-sm outline-none"
                  />
                </div>
                <Button
                  size="md"
                  onClick={() => extrair.mutate(a.id)}
                  disabled={extrair.isPending}
                >
                  <Wand2 size={17} />
                  {extrair.isPending ? 'Extraindo…' : 'Extrair estrutura'}
                </Button>

                {resultado[a.id] && (
                  <div className="bg-surface-sunken rounded-control p-4">
                    <p className="text-ui">
                      {resultado[a.id]!.entities_count} entidades extraidas.
                    </p>
                    <dl className="mt-2 font-mono text-ui-sm">
                      {Object.entries(resultado[a.id]!.entities_by_kind).map(([tipo, n]) => (
                        <div key={tipo} className="flex justify-between">
                          <dt className="text-text-muted">{tipo}</dt>
                          <dd className="tabular-nums">{n}</dd>
                        </div>
                      ))}
                    </dl>
                    {resultado[a.id]!.truncated && (
                      <p className="text-warning mt-2 text-ui-sm">
                        A lista foi cortada em 200 entidades.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <Button variant="ghost" size="md" onClick={() => setEditando(null)}>
                Fechar
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              {a.cover_url && (
                <img
                  src={a.cover_url}
                  alt=""
                  className="rounded-control h-14 w-24 shrink-0 object-cover"
                />
              )}
              <p className="text-text-muted min-w-0 flex-1 truncate text-ui">
                {a.synopsis ?? 'Sem sinopse'}
              </p>
              <Button variant="subtle" size="md" onClick={() => setEditando(a.id)}>
                Editar
              </Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}
