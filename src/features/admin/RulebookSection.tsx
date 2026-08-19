// O livro de regras, dentro da tela do sistema.
//
// Antes era uma aba propria com um select de sistema em cima. Isso separava
// duas coisas que sao a mesma: o livro e o que da regras ao sistema, e o
// `rules_digest` extraido dele e o que vai no prompt de cada turno. Ter as duas
// telas apartadas fazia parecer que publicar o sistema bastava — e o Mestre
// jogava sem regra nenhuma no contexto.

import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, CircleCheck, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { getSupabase } from '@/lib/supabase'
import { api, ApiError, type RespostaDeIngestao } from '@/lib/api'
import { TOKENS_POR_PAGINA_PDF, contarPaginasPdf } from '@/lib/pdf'

interface Livro {
  id: string
  title: string
  storage_path: string | null
  page_count: number | null
  digest: string | null
  ingested_at: string | null
  original_size_bytes: number | null
  ingest_tokens_input: number | null
}

/** O provedor aceita 50 MB; a function corta em 40 por seguranca. */
const MAX_BYTES_PDF = 40 * 1024 * 1024

export function RulebookSection({
  systemId,
  temDigest,
}: {
  systemId: string
  /** O sistema ja tem rules_digest publicado. */
  temDigest: boolean
}) {
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<RespostaDeIngestao | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const livros = useQuery({
    queryKey: ['admin', 'livros', systemId],
    queryFn: async (): Promise<Livro[]> => {
      const { data, error } = await getSupabase()
        .from('rulebooks')
        .select(
          'id, title, storage_path, page_count, digest, ingested_at, original_size_bytes, ingest_tokens_input',
        )
        .eq('system_id', systemId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })

  const ingerir = useMutation({
    mutationFn: async (id: string) => api.ingerirLivro(id, true),
    onSuccess: (r) => {
      setResultado(r)
      setErro(null)
      void qc.invalidateQueries({ queryKey: ['admin', 'livros', systemId] })
      // O digest publicado muda o sistema: a tela de cima mostra isso.
      void qc.invalidateQueries({ queryKey: ['admin', 'sistema', systemId] })
    },
    onError: (e) =>
      setErro(e instanceof ApiError ? e.message : 'Falha na leitura do livro.'),
  })

  const remover = useMutation({
    mutationFn: async (livro: Livro) => {
      if (livro.storage_path) {
        await getSupabase().storage.from('rulebooks').remove([livro.storage_path])
      }
      const { error } = await getSupabase().from('rulebooks').delete().eq('id', livro.id)
      if (error) throw error
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['admin', 'livros', systemId] }),
    onError: (e) => setErro(e instanceof Error ? e.message : 'Falha ao remover o livro.'),
  })

  async function subirPdf(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    if (!arquivo) return
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

    setEnviando(true)
    try {
      const supabase = getSupabase()
      const path = `${systemId}/${crypto.randomUUID()}.pdf`

      const { error: upErro } = await supabase.storage
        .from('rulebooks')
        .upload(path, arquivo, { contentType: 'application/pdf' })
      if (upErro) throw new Error(upErro.message)

      // A contagem vale o esforco porque e ela que da a estimativa de custo
      // ANTES de apertar o botao que gasta. Quando falha, fica nula e a UI diz.
      const paginas = await contarPaginasPdf(arquivo).catch(() => null)

      const { error: insErro } = await supabase.from('rulebooks').insert({
        system_id: systemId,
        title: arquivo.name.replace(/\.pdf$/i, ''),
        storage_path: path,
        page_count: paginas,
      })
      if (insErro) throw new Error(insErro.message)

      await qc.invalidateQueries({ queryKey: ['admin', 'livros', systemId] })
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao enviar o PDF.')
    } finally {
      setEnviando(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const livrosLidos = (livros.data ?? []).filter((l) => l.ingested_at)

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-title">Livro de regras</h2>
        <p className="text-text-muted text-ui mt-1">
          O PDF e lido uma vez e vira um resumo operacional das regras. Depois disso o
          arquivo e <strong className="text-text">apagado</strong> — o resumo e o que vai
          no prompt de cada turno.
        </p>
      </div>

      {/* Aviso que vale mais que qualquer outro nesta tela: sistema publicado
          sem digest joga sem regras, e nada na tela dizia isso antes. */}
      {!temDigest && (
        <div className="bg-surface-sunken rounded-control p-4">
          <p className="text-warning text-ui">
            Este sistema ainda nao tem regras no prompt.
          </p>
          <p className="text-text-muted text-ui-sm mt-1">
            Sem o resumo publicado, o Mestre narra sabendo apenas o nome do sistema.
          </p>
        </div>
      )}

      {temDigest && livrosLidos.length > 0 && (
        <div className="flex items-center gap-2">
          <CircleCheck size={18} className="text-success shrink-0" />
          <p className="text-ui">
            Regras no prompt, extraidas de {livrosLidos[0]!.title}.
          </p>
        </div>
      )}

      {erro && (
        <p role="alert" className="text-danger text-ui">
          {erro}
        </p>
      )}

      {livros.data?.map((l) => (
        <div key={l.id} className="bg-surface-sunken rounded-control space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-ui font-display truncate font-bold">{l.title}</p>
              <p className="text-text-muted text-ui-sm font-mono">{estado(l)}</p>
            </div>
            <button
              type="button"
              onClick={() => remover.mutate(l)}
              disabled={remover.isPending}
              aria-label={`Remover ${l.title}`}
              className="text-text-muted hover:text-danger shrink-0 p-1 transition-colors"
            >
              <Trash2 size={17} />
            </button>
          </div>

          {!l.ingested_at && l.storage_path && (
            <div className="space-y-2">
              <p className="text-text-muted text-ui-sm">
                {l.page_count
                  ? `estimativa: ~${(l.page_count * TOKENS_POR_PAGINA_PDF).toLocaleString('pt-BR')} tokens de entrada`
                  : 'nao foi possivel contar as paginas deste PDF, entao nao ha estimativa de custo'}
              </p>
              <Button
                size="md"
                onClick={() => ingerir.mutate(l.id)}
                disabled={ingerir.isPending}
              >
                <BookOpen size={17} />
                {ingerir.isPending ? 'Lendo…' : 'Ler o livro'}
              </Button>
            </div>
          )}

          {resultado?.rulebook_id === l.id && (
            <p className="text-text-muted text-ui-sm font-mono">
              {resultado.usage.promptTokens.toLocaleString('pt-BR')} tokens de entrada
              {resultado.dice_notation ? ` · dados: ${resultado.dice_notation}` : ''}
              {resultado.file_deleted ? ' · PDF apagado' : ''}
            </p>
          )}

          {l.digest && (
            <details>
              <summary className="text-text-muted hover:text-text text-ui-sm cursor-pointer">
                Ver o resumo das regras
              </summary>
              <p className="narrative mt-3 whitespace-pre-wrap">{l.digest}</p>
            </details>
          )}
        </div>
      ))}

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        onChange={subirPdf}
        className="hidden"
        aria-label="Escolher PDF"
      />
      <Button
        variant="subtle"
        size="md"
        onClick={() => inputRef.current?.click()}
        disabled={enviando}
      >
        <Upload size={17} />
        {enviando ? 'Enviando…' : 'Enviar PDF'}
      </Button>
    </section>
  )
}

function estado(l: Livro): string {
  if (l.ingested_at) {
    const tokens = l.ingest_tokens_input
      ? `${l.ingest_tokens_input.toLocaleString('pt-BR')} tokens lidos`
      : 'lido'
    const liberado = l.original_size_bytes
      ? ` · ${(l.original_size_bytes / 1048576).toFixed(1)} MB liberados`
      : ''
    return `${tokens}${liberado}`
  }
  if (!l.storage_path) return 'sem arquivo — envie de novo para reingerir'
  return l.page_count
    ? `${l.page_count} paginas · aguardando leitura`
    : 'aguardando leitura'
}
