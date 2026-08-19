import { useRef, useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { enviarCapa, validarCapa } from '@/lib/storage'

/**
 * Upload de capa. Diferente das cenas, a capa FICA no Supabase: e publica, e
 * uma por registro, e pequena.
 *
 * A pre-visualizacao usa a URL local do arquivo escolhido, para a imagem
 * aparecer antes do upload terminar.
 */
export function CoverUpload({
  prefixo,
  urlAtual,
  pathAtual,
  onEnviada,
  onRemovida,
}: {
  /** Pasta dentro do bucket, tipicamente o id do registro. */
  prefixo: string
  urlAtual: string | null
  pathAtual: string | null
  onEnviada: (capa: { path: string; url: string }) => void
  onRemovida: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [previa, setPrevia] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    if (!arquivo) return
    setErro(null)

    const invalido = validarCapa(arquivo)
    if (invalido) {
      setErro(invalido)
      return
    }

    const local = URL.createObjectURL(arquivo)
    setPrevia(local)
    setEnviando(true)
    try {
      const capa = await enviarCapa(arquivo, prefixo, pathAtual)
      onEnviada(capa)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha no envio.')
      setPrevia(null)
    } finally {
      setEnviando(false)
      URL.revokeObjectURL(local)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const mostrar = previa ?? urlAtual

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        onChange={escolher}
        className="hidden"
        aria-label="Escolher imagem de capa"
      />

      {mostrar ? (
        <div className="space-y-2">
          <img
            src={mostrar}
            alt="Capa"
            className="rounded-card aspect-video w-full object-cover"
          />
          <div className="flex gap-2">
            <Button
              variant="subtle"
              size="md"
              onClick={() => inputRef.current?.click()}
              disabled={enviando}
            >
              <ImagePlus size={17} />
              {enviando ? 'Enviando…' : 'Trocar'}
            </Button>
            <Button
              variant="ghost"
              size="md"
              onClick={onRemovida}
              disabled={enviando}
              aria-label="Remover capa"
            >
              <Trash2 size={17} />
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={enviando}
          className="bg-surface-sunken rounded-card grid aspect-video w-full place-items-center disabled:opacity-50"
        >
          <span className="text-text-muted flex flex-col items-center gap-2 text-ui">
            <ImagePlus size={26} strokeWidth={2} />
            {enviando ? 'Enviando…' : 'Adicionar capa'}
          </span>
        </button>
      )}

      {erro && (
        <p role="alert" className="text-danger text-ui-sm">
          {erro}
        </p>
      )}
      <p className="text-text-muted text-ui-sm">JPG, PNG, WebP ou AVIF, ate 2 MB.</p>
    </div>
  )
}
