import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { getSupabase } from '@/lib/supabase'
import { apagarCapa } from '@/lib/storage'
import { CoverUpload } from './CoverUpload'

interface Sistema {
  id: string
  slug: string
  name: string
  tagline: string | null
  description: string | null
  cover_url: string | null
  cover_path: string | null
  is_published: boolean
}

export function paraSlug(texto: string): string {
  // Sem regex de caracteres combinantes: escrito literalmente no fonte, ele se
  // perde em conversao de encoding. Filtrar por code point e equivalente e
  // sobrevive a qualquer editor.
  const semAcento = texto
    .toLowerCase()
    .normalize('NFD')
    .split('')
    .filter((c) => {
      const code = c.charCodeAt(0)
      return code < 0x300 || code > 0x36f
    })
    .join('')

  return semAcento.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sem-nome'
}

export function SystemsPanel() {
  const qc = useQueryClient()
  const [editando, setEditando] = useState<string | null>(null)
  const [criando, setCriando] = useState(false)
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const sistemas = useQuery({
    queryKey: ['admin', 'sistemas'],
    queryFn: async (): Promise<Sistema[]> => {
      const { data, error } = await getSupabase()
        .from('systems')
        .select('id, slug, name, tagline, description, cover_url, cover_path, is_published')
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })

  const criar = useMutation({
    mutationFn: async (nomeNovo: string) => {
      const { data, error } = await getSupabase()
        .from('systems')
        .insert({ name: nomeNovo, slug: paraSlug(nomeNovo), is_published: false })
        .select('id')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (novo) => {
      setNome('')
      setCriando(false)
      setEditando(novo.id)
      void qc.invalidateQueries({ queryKey: ['admin', 'sistemas'] })
    },
    onError: (e) => setErro(e instanceof Error ? e.message : 'Falha ao criar.'),
  })

  const salvar = useMutation({
    mutationFn: async ({ id, campos }: { id: string; campos: Partial<Sistema> }) => {
      const { error } = await getSupabase().from('systems').update(campos).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'sistemas'] })
      void qc.invalidateQueries({ queryKey: ['sistemas'] })
    },
    onError: (e) => setErro(e instanceof Error ? e.message : 'Falha ao salvar.'),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-title">Sistemas</h2>
        <Button variant="subtle" size="md" onClick={() => setCriando((v) => !v)}>
          <Plus size={17} />
          Novo
        </Button>
      </div>

      {erro && (
        <p role="alert" className="text-danger text-ui">
          {erro}
        </p>
      )}

      {criando && (
        <Card className="space-y-3">
          <div className="bg-surface-sunken rounded-control px-4">
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Nome do sistema"
              aria-label="Nome do sistema"
              className="text-ui placeholder:text-text-muted w-full bg-transparent py-3 outline-none"
            />
          </div>
          <Button
            size="md"
            onClick={() => criar.mutate(nome.trim())}
            disabled={!nome.trim() || criar.isPending}
          >
            {criar.isPending ? 'Criando…' : 'Criar'}
          </Button>
        </Card>
      )}

      {sistemas.isPending && (
        <div className="bg-surface-1 rounded-card h-24 animate-pulse" aria-busy="true" />
      )}

      {sistemas.data?.map((s) => (
        <Card key={s.id} className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-title truncate">{s.name}</h3>
              <p className="text-text-muted font-mono text-ui-sm">{s.slug}</p>
            </div>
            <Button
              variant={s.is_published ? 'primary' : 'subtle'}
              size="md"
              onClick={() => salvar.mutate({ id: s.id, campos: { is_published: !s.is_published } })}
              className="shrink-0 px-4"
              aria-label={s.is_published ? 'Despublicar' : 'Publicar'}
            >
              {s.is_published ? <Eye size={17} /> : <EyeOff size={17} />}
              {s.is_published ? 'No ar' : 'Rascunho'}
            </Button>
          </div>

          {editando === s.id ? (
            <div className="space-y-4">
              <CoverUpload
                prefixo={`systems/${s.id}`}
                urlAtual={s.cover_url}
                pathAtual={s.cover_path}
                onEnviada={(capa) =>
                  salvar.mutate({
                    id: s.id,
                    campos: { cover_url: capa.url, cover_path: capa.path },
                  })
                }
                onRemovida={async () => {
                  if (s.cover_path) await apagarCapa(s.cover_path).catch(() => {})
                  salvar.mutate({ id: s.id, campos: { cover_url: null, cover_path: null } })
                }}
              />

              <div className="bg-surface-sunken rounded-control px-4">
                <input
                  defaultValue={s.tagline ?? ''}
                  onBlur={(e) => salvar.mutate({ id: s.id, campos: { tagline: e.target.value } })}
                  placeholder="Uma linha que vende o sistema"
                  aria-label="Tagline"
                  className="text-ui placeholder:text-text-muted w-full bg-transparent py-3 outline-none"
                />
              </div>

              <div className="bg-surface-sunken rounded-control px-4">
                <textarea
                  defaultValue={s.description ?? ''}
                  onBlur={(e) =>
                    salvar.mutate({ id: s.id, campos: { description: e.target.value } })
                  }
                  rows={4}
                  placeholder="Descricao para a vitrine"
                  aria-label="Descricao"
                  className="text-ui placeholder:text-text-muted w-full resize-y bg-transparent py-3 outline-none"
                />
              </div>

              <Button variant="ghost" size="md" onClick={() => setEditando(null)}>
                Fechar
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              {s.cover_url && (
                <img
                  src={s.cover_url}
                  alt=""
                  className="rounded-control h-14 w-24 shrink-0 object-cover"
                />
              )}
              <p className="text-text-muted min-w-0 flex-1 truncate text-ui">
                {s.tagline ?? 'Sem tagline'}
              </p>
              <Button variant="subtle" size="md" onClick={() => setEditando(s.id)}>
                Editar
              </Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}
