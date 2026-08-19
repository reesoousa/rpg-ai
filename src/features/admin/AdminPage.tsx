// Indice do painel do mestre: a lista de sistemas.
//
// Deixou de ter abas. Cada sistema abre a propria tela, com livro e aventuras
// dentro — ver SystemPage. O que esta linha mostra e o que falta em cada um,
// para nao ser preciso entrar para descobrir.

import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { getSupabase } from '@/lib/supabase'
import { paraSlug } from './slug'

interface LinhaDeSistema {
  id: string
  slug: string
  name: string
  tagline: string | null
  cover_url: string | null
  is_published: boolean
}

export function AdminPage() {
  const qc = useQueryClient()
  const [criando, setCriando] = useState(false)
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const sistemas = useQuery({
    queryKey: ['admin', 'sistemas'],
    queryFn: async (): Promise<LinhaDeSistema[]> => {
      const { data, error } = await getSupabase()
        .from('systems')
        .select('id, slug, name, tagline, cover_url, is_published')
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })

  /**
   * Resumo por sistema: quantos livros lidos e quantas aventuras publicadas.
   *
   * Duas consultas rasas em vez de N por linha. `rules_digest` nao entra no
   * grant do cliente, entao "tem regras" e inferido de livro com ingested_at.
   */
  const resumo = useQuery({
    queryKey: ['admin', 'resumo-sistemas'],
    enabled: Boolean(sistemas.data?.length),
    queryFn: async () => {
      const sb = getSupabase()
      const [livros, aventuras] = await Promise.all([
        sb.from('rulebooks').select('system_id, ingested_at'),
        sb.from('adventures').select('system_id, is_published'),
      ])
      if (livros.error) throw livros.error
      if (aventuras.error) throw aventuras.error

      const porSistema: Record<string, { regras: boolean; aventuras: number }> = {}
      const entrada = (id: string) => (porSistema[id] ??= { regras: false, aventuras: 0 })

      for (const l of livros.data ?? []) {
        if (l.ingested_at) entrada(l.system_id).regras = true
      }
      for (const a of aventuras.data ?? []) {
        if (a.is_published) entrada(a.system_id).aventuras += 1
      }
      return porSistema
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
    onSuccess: () => {
      setNome('')
      setCriando(false)
      void qc.invalidateQueries({ queryKey: ['admin', 'sistemas'] })
    },
    onError: (e) => setErro(e instanceof Error ? e.message : 'Falha ao criar.'),
  })

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-display">Painel do mestre</h1>
        <p className="text-text-muted text-ui mt-1">
          Cada sistema guarda o proprio livro de regras e as proprias aventuras.
        </p>
      </header>

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
              onKeyDown={(e) => {
                if (e.key === 'Enter' && nome.trim()) criar.mutate(nome.trim())
              }}
              placeholder="Nome do sistema"
              aria-label="Nome do sistema"
              autoFocus
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

      {!sistemas.isPending && !sistemas.data?.length && !criando && (
        <Card>
          <p className="text-ui">Nenhum sistema ainda.</p>
          <p className="text-text-muted text-ui-sm mt-1">
            Crie um, envie o PDF das regras e publique — nessa ordem.
          </p>
        </Card>
      )}

      <div className="space-y-3">
        {sistemas.data?.map((s) => {
          const r = resumo.data?.[s.id]
          return (
            <Link key={s.id} to={`/admin/sistema/${s.id}`} className="block">
              <Card className="hover:bg-surface-2 transition-colors duration-150 ease-out">
                <div className="flex items-center gap-4">
                  {s.cover_url && (
                    <img
                      src={s.cover_url}
                      alt=""
                      className="rounded-control h-14 w-24 shrink-0 object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <h3 className="text-title truncate">{s.name}</h3>
                    <p className="text-text-muted text-ui-sm font-mono">
                      {s.is_published ? 'no ar' : 'rascunho'}
                      {r ? ` · ${r.regras ? 'regras lidas' : 'sem regras'}` : ''}
                      {r?.aventuras ? ` · ${r.aventuras} aventuras` : ''}
                    </p>
                  </div>
                  <ChevronRight size={20} className="text-text-muted shrink-0" />
                </div>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
