import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { getSupabase } from '@/lib/supabase'
import { api, ApiError, type RespostaDeIngestao } from '@/lib/api'

interface Livro {
  id: string
  system_id: string
  title: string
  storage_path: string | null
  page_count: number | null
  digest: string | null
  ingested_at: string | null
  original_size_bytes: number | null
}

/** O provedor aceita 50 MB; a function corta em 40 por seguranca. */
const MAX_BYTES_PDF = 40 * 1024 * 1024

export function RulebooksPanel() {
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [sistemaId, setSistemaId] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<Record<string, RespostaDeIngestao>>({})
  const [erro, setErro] = useState<string | null>(null)

  const sistemas = useQuery({
    queryKey: ['admin', 'sistemas', 'simples'],
    queryFn: async () => {
      const { data, error } = await getSupabase().from('systems').select('id, name').order('name')
      if (error) throw error
      return data ?? []
    },
  })

  const livros = useQuery({
    queryKey: ['admin', 'livros'],
    queryFn: async (): Promise<Livro[]> => {
      const { data, error } = await getSupabase()
        .from('rulebooks')
        .select('id, system_id, title, storage_path, page_count, digest, ingested_at, original_size_bytes')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })

  const ingerir = useMutation({
    mutationFn: async (id: string) => api.ingerirLivro(id, true),
    onSuccess: (r) => {
      setResultado((atual) => ({ ...atual, [r.rulebook_id]: r }))
      void qc.invalidateQueries({ queryKey: ['admin', 'livros'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'sistemas'] })
    },
    onError: (e) => setErro(e instanceof ApiError ? e.message : 'Falha na ingestao.'),
  })

  async function subirPdf(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    if (!arquivo || !sistemaId) return
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
      const path = `${sistemaId}/${crypto.randomUUID()}.pdf`

      const { error: upErro } = await supabase.storage
        .from('rulebooks')
        .upload(path, arquivo, { contentType: 'application/pdf' })
      if (upErro) throw new Error(upErro.message)

      const { error: insErro } = await supabase.from('rulebooks').insert({
        system_id: sistemaId,
        title: arquivo.name.replace(/\.pdf$/i, ''),
        storage_path: path,
      })
      if (insErro) throw new Error(insErro.message)

      await qc.invalidateQueries({ queryKey: ['admin', 'livros'] })
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao enviar o PDF.')
    } finally {
      setEnviando(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-title">Livros de regras</h2>

      <Card className="space-y-3">
        <p className="text-text-muted text-ui">
          O PDF e lido uma vez e vira um resumo operacional das regras. Depois disso o
          arquivo e <strong className="text-text">apagado</strong> — o resumo e o que vai
          no prompt de cada turno.
        </p>

        <div className="bg-surface-sunken rounded-control px-4">
          <select
            value={sistemaId}
            onChange={(e) => setSistemaId(e.target.value)}
            aria-label="Sistema do livro"
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

        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          onChange={subirPdf}
          className="hidden"
          aria-label="Escolher PDF"
        />
        <Button
          size="md"
          onClick={() => inputRef.current?.click()}
          disabled={!sistemaId || enviando}
        >
          <Upload size={17} />
          {enviando ? 'Enviando…' : 'Enviar PDF'}
        </Button>

        {erro && (
          <p role="alert" className="text-danger text-ui">
            {erro}
          </p>
        )}
      </Card>

      {livros.data?.map((l) => (
        <Card key={l.id} className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-ui font-display truncate font-bold">{l.title}</h3>
              <p className="text-text-muted font-mono text-ui-sm">
                {l.ingested_at
                  ? `lido · ${l.original_size_bytes ? `${(l.original_size_bytes / 1048576).toFixed(1)} MB liberados` : 'arquivo apagado'}`
                  : l.storage_path
                    ? 'aguardando leitura'
                    : 'sem arquivo'}
              </p>
            </div>
            {!l.ingested_at && l.storage_path && (
              <Button
                size="md"
                onClick={() => ingerir.mutate(l.id)}
                disabled={ingerir.isPending}
                className="shrink-0"
              >
                <BookOpen size={17} />
                {ingerir.isPending ? 'Lendo…' : 'Ler e publicar'}
              </Button>
            )}
          </div>

          {resultado[l.id] && (
            <div className="bg-surface-sunken rounded-control space-y-2 p-4">
              <p className="text-ui">
                Regras extraidas
                {resultado[l.id]!.dice_notation
                  ? ` · dados: ${resultado[l.id]!.dice_notation}`
                  : ''}
              </p>
              <p className="text-text-muted font-mono text-ui-sm">
                {resultado[l.id]!.usage.promptTokens.toLocaleString('pt-BR')} tokens de
                entrada
                {resultado[l.id]!.file_deleted ? ' · PDF apagado' : ' · PDF mantido'}
              </p>
            </div>
          )}

          {l.digest && (
            <details>
              <summary className="text-text-muted hover:text-text cursor-pointer text-ui-sm">
                Ver o resumo das regras
              </summary>
              <p className="narrative mt-3 whitespace-pre-wrap">{l.digest}</p>
            </details>
          )}
        </Card>
      ))}
    </div>
  )
}
