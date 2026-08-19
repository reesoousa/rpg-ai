import { useEffect, useState } from 'react'
import { Download, ImageIcon, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { lerCena } from '@/lib/scene-cache'

/**
 * A imagem da cena vive no dispositivo, nao no Supabase.
 *
 * Isso tem uma consequencia que precisa ficar VISIVEL: trocar de aparelho ou
 * limpar o navegador perde a imagem. Por isso o botao de salvar aparece sempre
 * que ha imagem, e o de regerar avisa que custa quota.
 */
export function SceneImage({
  campaignId,
  seq,
  temPrompt,
  onRegerar,
  regerando,
}: {
  campaignId: string
  seq: number
  /** O banco sabe que esta cena ja foi gerada uma vez. */
  temPrompt: boolean
  onRegerar: () => void
  regerando: boolean
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [procurou, setProcurou] = useState(false)

  useEffect(() => {
    let objectUrl: string | null = null
    let ativo = true

    lerCena(campaignId, seq).then((cena) => {
      if (!ativo) return
      if (cena) {
        objectUrl = URL.createObjectURL(cena.blob)
        setUrl(objectUrl)
      }
      setProcurou(true)
    })

    return () => {
      ativo = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [campaignId, seq, regerando])

  if (!procurou) return null

  // Nunca houve cena para este turno: nada a mostrar.
  if (!url && !temPrompt) return null

  // Houve cena, mas nao esta neste dispositivo.
  if (!url) {
    return (
      <div className="bg-surface-1 rounded-card shadow-1 p-5">
        <ImageIcon size={24} strokeWidth={2} className="text-text-muted mb-3" />
        <p className="text-text-muted text-ui">
          Esta cena teve uma imagem, mas ela nao esta neste aparelho — as imagens ficam
          salvas no dispositivo, nao na nuvem.
        </p>
        <Button
          variant="subtle"
          size="md"
          onClick={onRegerar}
          disabled={regerando}
          className="mt-4"
        >
          <RefreshCw size={17} className={regerando ? 'animate-spin' : undefined} />
          {regerando ? 'Gerando…' : 'Gerar de novo'}
        </Button>
        <p className="text-text-muted mt-2 text-ui-sm">Gerar de novo consome sua quota de imagens.</p>
      </div>
    )
  }

  return (
    <figure className="space-y-3">
      <img
        src={url}
        alt={`Cena do turno ${seq}`}
        className="rounded-card shadow-1 w-full"
        loading="lazy"
      />
      <figcaption className="flex flex-wrap items-center gap-2">
        {/* Download de blob local: nao passa por rede, funciona offline. */}
        <a
          href={url}
          download={`cena-${seq}.jpg`}
          className="text-text-muted hover:text-text inline-flex h-9 items-center gap-1.5 text-ui-sm transition-colors duration-150 ease-out"
        >
          <Download size={15} />
          Salvar no aparelho
        </a>
        <button
          type="button"
          onClick={onRegerar}
          disabled={regerando}
          className="text-text-muted hover:text-text inline-flex h-9 items-center gap-1.5 text-ui-sm transition-colors duration-150 ease-out disabled:opacity-50"
        >
          <RefreshCw size={15} className={regerando ? 'animate-spin' : undefined} />
          {regerando ? 'Gerando…' : 'Gerar outra'}
        </button>
      </figcaption>
    </figure>
  )
}
