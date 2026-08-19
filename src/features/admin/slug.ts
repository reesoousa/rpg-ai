/**
 * Nome legivel -> slug de URL.
 *
 * Sem regex de caracteres combinantes: escrito literalmente no fonte, ele se
 * perde em conversao de encoding. Filtrar por code point e equivalente e
 * sobrevive a qualquer editor.
 */
export function paraSlug(texto: string): string {
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
