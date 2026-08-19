// Aventuras do sistema, com a fabrica de campanhas embutida.
//
// Antes era uma aba solta com um select de sistema. O efeito colateral disso
// era pratico: dava para criar aventura sem perceber que o sistema dela nao
// tinha regras lidas, e a lista misturava aventuras de sistemas diferentes.

import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, Eye, EyeOff, Plus, Trash2, Upload, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { getSupabase } from '@/lib/supabase'
import { apagarCapa } from '@/lib/storage'
import { api, ApiError, type RespostaDeExtracao } from '@/lib/api'
import { CoverUpload } from './CoverUpload'
import { paraSlug } from './slug'

/** O provedor aceita 50 MB; a function corta em 40 por seguranca. */
const MAX_BYTES_PDF = 40 * 1024 * 1024

interface Aventura {
  id: string
  slug: string
  title: string
  synopsis: string | null
  cover_url: string | null
  cover_path: string | null
  is_published: boolean
}

export function AdventuresSection({ systemId }: { systemId: string }) {
  const qc = useQueryClient()
  const [criando, setCriando] = useState(false)
  const [titulo, setTitulo] = useState('')
  const [aberta, setAberta] = useState<string | null>(null)
  const [textoFonte, setTextoFonte] = useState<Record<string, string>>({})
  const [resultado, setResultado] = useState<Record<string, RespostaDeExtracao>>({})
  const [enviandoPdf, setEnviandoPdf] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const inputPdf = useRef<HTMLInputElement>(null)
  const alvoDoPdf = useRef<string | null>(null)

  const aventuras = useQuery({
    queryKey: ['admin', 'aventuras', systemId],
    queryFn: async (): Promise<Aventura[]> => {
      const { data, error } = await getSupabase()
        .from('adventures')
        .select('id, slug, title, synopsis, cover_url, cover_path, is_published')
        .eq('system_id', systemId)
        .order('title')
      if (error) throw error
      return data ?? []
    },
  })

  /**
   * Quantas entidades cada aventura ja tem extraidas.
   *
   * Sem isto, "extrair estrutura" era um botao sem retorno visivel: o mestre
   * nao tinha como saber se a aventura tinha elenco no banco ou se o Mestre ia
   * narrar so pela sinopse.
   */
  const entidades = useQuery({
    queryKey: ['admin', 'entidades', systemId],
    enabled: Boolean(aventuras.data?.length),
    queryFn: async (): Promise<Record<string, number>> => {
      const ids = (aventuras.data ?? []).map((a) => a.id)
      if (!ids.length) return {}
      const { data, error } = await getSupabase()
        .from('adventure_entities')
        .select('adventure_id')
        .in('adventure_id', ids)
      if (error) throw error
      const contagem: Record<string, number> = {}
      for (const e of data ?? []) {
        contagem[e.adventure_id] = (contagem[e.adventure_id] ?? 0) + 1
      }
      return contagem
    },
  })

  const criar = useMutation({
    mutationFn: async () => {
      const { data, error } = await getSupabase()
        .from('adventures')
        .insert({
          system_id: systemId,
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
      setCriando(false)
      setAberta(nova.id)
      void qc.invalidateQueries({ queryKey: ['admin', 'aventuras', systemId] })
    },
    onError: (e) => setErro(e instanceof Error ? e.message : 'Falha ao criar.'),
  })

  const salvar = useMutation({
    mutationFn: async ({ id, campos }: { id: string; campos: Partial<Aventura> }) => {
      const { error } = await getSupabase().from('adventures').update(campos).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'aventuras', systemId] })
      void qc.invalidateQueries({ queryKey: ['aventuras', systemId] })
    },
    onError: (e) => setErro(e instanceof Error ? e.message : 'Falha ao salvar.'),
  })

  const apagar = useMutation({
    mutationFn: async (a: Aventura) => {
      if (a.cover_path) await apagarCapa(a.cover_path).catch(() => {})
      const { error } = await getSupabase().from('adventures').delete().eq('id', a.id)
      if (error) throw error
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['admin', 'aventuras', systemId] }),
    onError: (e) => setErro(e instanceof Error ? e.message : 'Falha ao apagar.'),
  })

  const extrair = useMutation({
    mutationFn: async ({ id, pdfPath }: { id: string; pdfPath?: string }) =>
      api.extrairAventura(id, { texto: textoFonte[id], pdfPath }),
    onSuccess: (r) => {
      setResultado((atual) => ({ ...atual, [r.adventure_id]: r }))
      setErro(null)
      void qc.invalidateQueries({ queryKey: ['admin', 'entidades', systemId] })
      // A sinopse pode ter vindo do documento: a lista precisa recarregar.
      if (r.synopsis)
        void qc.invalidateQueries({ queryKey: ['admin', 'aventuras', systemId] })
    },
    onError: (e) => setErro(e instanceof ApiError ? e.message : 'Falha na extracao.'),
  })

  /**
   * Sobe o PDF e extrai na sequencia.
   *
   * O arquivo vai para o bucket `rulebooks` (privado, so o mestre alcanca) sob
   * o prefixo da aventura, e a function o apaga depois de ler. Nao ha coluna
   * para guardar o caminho de proposito: ele nao sobrevive a chamada.
   */
  async function extrairDePdf(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    const id = alvoDoPdf.current
    if (inputPdf.current) inputPdf.current.value = ''
    if (!arquivo || !id) return

    setErro(null)
    if (arquivo.type !== 'application/pdf') {
      setErro('O arquivo precisa ser um PDF.')
      return
    }
    if (arquivo.size > MAX_BYTES_PDF) {
      setErro(
        `O PDF tem ${(arquivo.size / 1048576).toFixed(1)} MB. O limite e 40 MB — divida o arquivo.`,
      )
      return
    }

    setEnviandoPdf(id)
    try {
      const path = `adventures/${id}/${crypto.randomUUID()}.pdf`
      const { error: upErro } = await getSupabase()
        .storage.from('rulebooks')
        .upload(path, arquivo, { contentType: 'application/pdf' })
      if (upErro) throw new Error(upErro.message)

      await extrair.mutateAsync({ id, pdfPath: path })
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao enviar o PDF.')
    } finally {
      setEnviandoPdf(null)
    }
  }

  return (
    <section className="space-y-4">
      {/* Um input para toda a secao: o alvo vai em `alvoDoPdf`, para nao criar
          um input por aventura. */}
      <input
        ref={inputPdf}
        type="file"
        accept="application/pdf"
        onChange={extrairDePdf}
        className="hidden"
        aria-label="Escolher PDF da aventura"
      />

      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-title">Aventuras</h2>
          <p className="text-text-muted text-ui mt-1">
            Aventura publicada aparece na criacao de campanha. O que a extracao encontra —
            lugares, pessoas, faccoes, itens, eventos — vai no prompt de cada turno.
          </p>
        </div>
        <Button
          variant="subtle"
          size="md"
          onClick={() => setCriando((v) => !v)}
          className="shrink-0"
        >
          <Plus size={17} />
          Nova
        </Button>
      </div>

      {erro && (
        <p role="alert" className="text-danger text-ui">
          {erro}
        </p>
      )}

      {criando && (
        <div className="bg-surface-sunken rounded-control space-y-3 p-4">
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Titulo da aventura"
            aria-label="Titulo da aventura"
            className="text-ui placeholder:text-text-muted w-full bg-transparent py-2 outline-none"
          />
          <Button
            size="md"
            onClick={() => criar.mutate()}
            disabled={!titulo.trim() || criar.isPending}
          >
            {criar.isPending ? 'Criando…' : 'Criar'}
          </Button>
        </div>
      )}

      {aventuras.isPending && (
        <div
          className="bg-surface-sunken rounded-control h-16 animate-pulse"
          aria-busy="true"
        />
      )}

      {!aventuras.isPending && !aventuras.data?.length && !criando && (
        <p className="text-text-muted text-ui-sm">
          Nenhuma aventura. Sem nenhuma, so da para jogar campanha livre neste sistema.
        </p>
      )}

      {aventuras.data?.map((a) => {
        const n = entidades.data?.[a.id] ?? 0
        const escancarada = aberta === a.id

        return (
          <div key={a.id} className="bg-surface-sunken rounded-control space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                onClick={() => setAberta(escancarada ? null : a.id)}
                className="min-w-0 flex-1 text-left"
                aria-expanded={escancarada}
              >
                <p className="text-ui font-display truncate font-bold">{a.title}</p>
                <p className="text-text-muted text-ui-sm font-mono">
                  {a.is_published ? 'no ar' : 'rascunho'}
                  {n > 0 ? ` · ${n} entidades` : ' · sem estrutura extraida'}
                </p>
              </button>

              <Button
                variant={a.is_published ? 'primary' : 'subtle'}
                size="md"
                onClick={() =>
                  salvar.mutate({ id: a.id, campos: { is_published: !a.is_published } })
                }
                className="shrink-0 px-4"
                aria-label={a.is_published ? 'Despublicar' : 'Publicar'}
              >
                {a.is_published ? <Eye size={17} /> : <EyeOff size={17} />}
              </Button>
            </div>

            {escancarada && (
              <div className="space-y-4 pt-1">
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
                    salvar.mutate({
                      id: a.id,
                      campos: { cover_url: null, cover_path: null },
                    })
                  }}
                />

                <textarea
                  defaultValue={a.synopsis ?? ''}
                  onBlur={(e) =>
                    salvar.mutate({ id: a.id, campos: { synopsis: e.target.value } })
                  }
                  rows={3}
                  placeholder="Sinopse (aparece na vitrine e na escolha de aventura)"
                  aria-label="Sinopse"
                  className="text-ui placeholder:text-text-muted w-full resize-y bg-transparent outline-none"
                />

                {/* --- fabrica de campanhas */}
                <div className="space-y-3">
                  <div>
                    <h3 className="text-ui font-display font-bold">
                      Estrutura da aventura
                    </h3>
                    <p className="text-text-muted text-ui-sm mt-1">
                      Envie o PDF do modulo ou cole o texto. O modelo extrai lugares,
                      pessoas, itens, faccoes e eventos — e e isso que o Mestre passa a
                      conhecer em jogo. O PDF e apagado depois de lido.
                    </p>
                  </div>

                  {n > 0 && !resultado[a.id] && (
                    <div className="flex items-center gap-2">
                      <CircleCheck size={17} className="text-success shrink-0" />
                      <p className="text-ui-sm">
                        {n} entidades no prompt desta aventura.
                      </p>
                    </div>
                  )}

                  <textarea
                    value={textoFonte[a.id] ?? ''}
                    onChange={(e) =>
                      setTextoFonte((t) => ({ ...t, [a.id]: e.target.value }))
                    }
                    rows={8}
                    placeholder="Texto ou resumo da aventura…"
                    aria-label="Texto de origem da aventura"
                    className="text-text-muted text-ui-sm w-full resize-y bg-transparent font-mono outline-none"
                  />

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="md"
                      onClick={() => {
                        alvoDoPdf.current = a.id
                        inputPdf.current?.click()
                      }}
                      disabled={extrair.isPending || enviandoPdf !== null}
                    >
                      <Upload size={17} />
                      {enviandoPdf === a.id
                        ? 'Enviando…'
                        : extrair.isPending && extrair.variables?.id === a.id
                          ? 'Lendo o PDF…'
                          : 'Ler PDF da aventura'}
                    </Button>

                    <Button
                      variant="subtle"
                      size="md"
                      onClick={() => extrair.mutate({ id: a.id })}
                      disabled={
                        extrair.isPending ||
                        enviandoPdf !== null ||
                        !textoFonte[a.id]?.trim()
                      }
                    >
                      <Wand2 size={17} />
                      {n > 0 ? 'Extrair do texto de novo' : 'Extrair do texto'}
                    </Button>
                  </div>

                  {resultado[a.id] && (
                    <div className="space-y-1">
                      <p className="text-ui">
                        {resultado[a.id]!.entities_count} entidades extraidas.
                      </p>
                      <p className="text-text-muted text-ui-sm font-mono">
                        {Object.entries(resultado[a.id]!.entities_by_kind)
                          .map(([tipo, q]) => `${tipo}: ${q}`)
                          .join(' · ')}
                      </p>
                      <p className="text-text-muted text-ui-sm font-mono">
                        fonte: {resultado[a.id]!.source}
                        {resultado[a.id]!.pdf_bytes
                          ? ` · ${(resultado[a.id]!.pdf_bytes! / 1048576).toFixed(1)} MB`
                          : ''}
                        {resultado[a.id]!.pdf_deleted ? ' · PDF apagado' : ''}
                      </p>
                      {resultado[a.id]!.synopsis && (
                        <p className="text-ui-sm">
                          <span className="text-text-muted">Sinopse sugerida: </span>
                          {resultado[a.id]!.synopsis}
                        </p>
                      )}
                      {resultado[a.id]!.truncated && (
                        <p className="text-warning text-ui-sm">
                          A lista foi cortada em 200 entidades.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (
                      confirm(`Apagar "${a.title}"? As entidades extraidas vao com ela.`)
                    ) {
                      apagar.mutate(a)
                    }
                  }}
                  disabled={apagar.isPending}
                  className="text-text-muted hover:text-danger text-ui-sm flex items-center gap-2 transition-colors"
                >
                  <Trash2 size={16} />
                  Apagar aventura
                </button>
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}
