// A tela de um sistema: tudo que o sistema precisa para ser jogavel, num lugar.
//
// Antes o painel tinha tres abas independentes — Sistemas, Aventuras, Livros —
// e um sistema completo exigia visitar as tres, acertando o select de sistema
// em cada uma. A consequencia real nao era estetica: dava para publicar um
// sistema sem regras lidas e sem aventura, e nada avisava.
//
// Aqui as tres coisas viram secoes da mesma tela, e o cabecalho mostra o que
// falta antes de publicar.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { ArrowLeft, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { getSupabase } from '@/lib/supabase'
import { apagarCapa } from '@/lib/storage'
import { CoverUpload } from './CoverUpload'
import { RulebookSection } from './RulebookSection'
import { AdventuresSection } from './AdventuresSection'

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

export function SystemPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()

  const sistema = useQuery({
    queryKey: ['admin', 'sistema', id],
    enabled: Boolean(id),
    queryFn: async (): Promise<Sistema> => {
      const { data, error } = await getSupabase()
        .from('systems')
        .select(
          'id, slug, name, tagline, description, cover_url, cover_path, is_published',
        )
        .eq('id', id!)
        .single()
      if (error) throw error
      return data
    },
  })

  /**
   * `rules_digest` esta fora do grant de leitura do cliente — e ele que vai no
   * prompt e nao precisa trafegar para o navegador. Para saber se existe, basta
   * saber se algum livro deste sistema foi lido.
   */
  const lidos = useQuery({
    queryKey: ['admin', 'livros-lidos', id],
    enabled: Boolean(id),
    queryFn: async (): Promise<number> => {
      const { count, error } = await getSupabase()
        .from('rulebooks')
        .select('id', { count: 'exact', head: true })
        .eq('system_id', id!)
        .not('ingested_at', 'is', null)
      if (error) throw error
      return count ?? 0
    },
  })

  const salvar = useMutation({
    mutationFn: async (campos: Partial<Sistema>) => {
      const { error } = await getSupabase().from('systems').update(campos).eq('id', id!)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'sistema', id] })
      void qc.invalidateQueries({ queryKey: ['admin', 'sistemas'] })
      void qc.invalidateQueries({ queryKey: ['sistemas'] })
    },
  })

  if (sistema.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="bg-surface-1 h-8 w-48 animate-pulse rounded-full" />
        <div className="bg-surface-1 rounded-card h-40 animate-pulse" />
      </div>
    )
  }

  if (sistema.isError || !sistema.data) {
    return (
      <div className="space-y-4">
        <p className="text-danger text-ui">Sistema nao encontrado.</p>
        <Button variant="subtle" size="md" onClick={() => void sistema.refetch()}>
          Tentar de novo
        </Button>
      </div>
    )
  }

  const s = sistema.data
  const temRegras = (lidos.data ?? 0) > 0

  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <Link
          to="/admin"
          className="text-text-muted hover:text-text text-ui-sm inline-flex items-center gap-2 transition-colors"
        >
          <ArrowLeft size={16} />
          Sistemas
        </Link>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-display truncate">{s.name}</h1>
            <p className="text-text-muted text-ui-sm font-mono">{s.slug}</p>
          </div>
          <Button
            variant={s.is_published ? 'primary' : 'subtle'}
            size="md"
            onClick={() => salvar.mutate({ is_published: !s.is_published })}
            className="shrink-0 px-4"
          >
            {s.is_published ? <Eye size={17} /> : <EyeOff size={17} />}
            {s.is_published ? 'No ar' : 'Rascunho'}
          </Button>
        </div>

        {s.is_published && !temRegras && (
          <p className="text-warning text-ui">
            Publicado sem livro lido: quem jogar este sistema joga sem regras no prompt.
          </p>
        )}
      </header>

      {/* ------------------------------------------------------- identidade */}
      <section className="space-y-4">
        <h2 className="text-title">Identidade</h2>

        <CoverUpload
          prefixo={`systems/${s.id}`}
          urlAtual={s.cover_url}
          pathAtual={s.cover_path}
          onEnviada={(capa) =>
            salvar.mutate({ cover_url: capa.url, cover_path: capa.path })
          }
          onRemovida={async () => {
            if (s.cover_path) await apagarCapa(s.cover_path).catch(() => {})
            salvar.mutate({ cover_url: null, cover_path: null })
          }}
        />

        <div className="bg-surface-sunken rounded-control px-4">
          <input
            defaultValue={s.name}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && v !== s.name) salvar.mutate({ name: v })
            }}
            placeholder="Nome do sistema"
            aria-label="Nome do sistema"
            className="text-ui placeholder:text-text-muted w-full bg-transparent py-3 outline-none"
          />
        </div>

        <div className="bg-surface-sunken rounded-control px-4">
          <input
            defaultValue={s.tagline ?? ''}
            onBlur={(e) => salvar.mutate({ tagline: e.target.value })}
            placeholder="Uma linha que vende o sistema"
            aria-label="Tagline"
            className="text-ui placeholder:text-text-muted w-full bg-transparent py-3 outline-none"
          />
        </div>

        <div className="bg-surface-sunken rounded-control px-4">
          <textarea
            defaultValue={s.description ?? ''}
            onBlur={(e) => salvar.mutate({ description: e.target.value })}
            rows={4}
            placeholder="Descricao para a vitrine"
            aria-label="Descricao"
            className="text-ui placeholder:text-text-muted w-full resize-y bg-transparent py-3 outline-none"
          />
        </div>
      </section>

      <RulebookSection systemId={s.id} temDigest={temRegras} />

      <AdventuresSection systemId={s.id} />
    </div>
  )
}
