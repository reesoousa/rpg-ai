import { getSupabase } from './supabase'

const BUCKET_CAPAS = 'covers'

/** Limite do bucket. Conferir aqui evita uma ida ao servidor para receber 413. */
export const MAX_BYTES_CAPA = 2 * 1024 * 1024

const TIPOS_ACEITOS = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']

export interface CapaEnviada {
  path: string
  url: string
}

export function validarCapa(arquivo: File): string | null {
  if (!TIPOS_ACEITOS.includes(arquivo.type)) {
    return 'Use JPG, PNG, WebP ou AVIF.'
  }
  if (arquivo.size > MAX_BYTES_CAPA) {
    return `A imagem tem ${(arquivo.size / 1048576).toFixed(1)} MB. O limite e 2 MB.`
  }
  return null
}

/**
 * Sobe a capa e devolve caminho e URL publica.
 *
 * `pathAntigo` e apagado depois do upload novo dar certo — nessa ordem, porque
 * apagar antes deixaria o registro sem capa se o upload falhasse.
 */
export async function enviarCapa(
  arquivo: File,
  prefixo: string,
  pathAntigo?: string | null,
): Promise<CapaEnviada> {
  const erro = validarCapa(arquivo)
  if (erro) throw new Error(erro)

  const supabase = getSupabase()
  const extensao = arquivo.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  // Nome novo a cada upload: o CDN cacheia por URL, então reusar o mesmo nome
  // faria a capa antiga continuar aparecendo.
  const path = `${prefixo}/${crypto.randomUUID()}.${extensao}`

  const { error: upErro } = await supabase.storage
    .from(BUCKET_CAPAS)
    .upload(path, arquivo, { contentType: arquivo.type, cacheControl: '31536000' })

  if (upErro) throw new Error(`Falha ao enviar a imagem: ${upErro.message}`)

  if (pathAntigo && pathAntigo !== path) {
    // Falha aqui nao invalida o upload: no pior caso sobra um arquivo orfao.
    const { error } = await supabase.storage.from(BUCKET_CAPAS).remove([pathAntigo])
    if (error) console.warn('capa antiga nao removida', pathAntigo, error.message)
  }

  const { data } = supabase.storage.from(BUCKET_CAPAS).getPublicUrl(path)
  return { path, url: data.publicUrl }
}

export async function apagarCapa(path: string): Promise<void> {
  const { error } = await getSupabase().storage.from(BUCKET_CAPAS).remove([path])
  if (error) throw new Error(`Falha ao remover a imagem: ${error.message}`)
}
