/**
 * Contagem de paginas de um PDF, sem biblioteca.
 *
 * POR QUE SEM BIBLIOTECA
 * O numero serve a uma coisa so: estimar o custo da ingestao antes de gastar
 * (cada pagina vale 258 tokens de entrada, entao um livro de 400 paginas e uma
 * chamada de ~103 mil tokens). Carregar um parser de PDF completo no bundle
 * do painel para calcular um aviso nao se paga.
 *
 * POR QUE PODE FALHAR
 * A leitura procura `/Count N` no texto cru do arquivo. Em PDF moderno com
 * xref comprimido, o catalogo pode estar dentro de um object stream deflatado
 * e nenhum `/Count` aparece em texto claro. Nesse caso a funcao devolve `null`
 * — e a UI diz que nao conseguiu estimar, em vez de inventar um numero.
 */
export async function contarPaginasPdf(arquivo: File): Promise<number | null> {
  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  // latin1 preserva byte a byte: o objetivo e achar tokens ASCII no meio de
  // dados binarios, e utf-8 substituiria bytes invalidos.
  const cru = new TextDecoder('latin1').decode(bytes)

  // Todo no de arvore de paginas tem /Count; a raiz tem o total, que e sempre
  // o maior. Intermediarios aparecem em livros grandes e valem menos.
  let maior = 0
  for (const m of cru.matchAll(/\/Count\s+(\d+)/g)) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n > maior) maior = n
  }
  if (maior > 0) return maior

  // Sem /Count legivel, sobra contar os objetos de pagina. `/Type /Page` sem o
  // `s` seguinte, para nao contar os nos `/Pages` da arvore.
  const paginas = cru.match(/\/Type\s*\/Page(?![\sa-zA-Z])/g)?.length ?? 0
  return paginas > 0 ? paginas : null
}

/** Uma pagina de PDF equivale a 258 tokens de entrada na API do Gemini. */
export const TOKENS_POR_PAGINA_PDF = 258
