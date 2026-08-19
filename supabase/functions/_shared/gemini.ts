// Cliente do Gemini via REST direto, sem SDK.
//
// Motivo: precisamos controlar o payload exato (safety, responseSchema,
// thinking) e degradar com elegancia quando um campo nao e aceito pelo modelo.
// Um SDK no meio esconderia justamente isso.

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export interface GeminiUsage {
  promptTokens: number
  outputTokens: number
  thoughtTokens: number
  cachedTokens: number
}

export interface GeminiResult<T> {
  data: T
  usage: GeminiUsage
  model: string
  finishReason: string
}

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'GeminiError'
  }

  /**
   * Resumo curto e seguro de mostrar.
   *
   * Motivo de existir: a function respondia sempre "Falha ao gerar" e jogava a
   * causa no console. Para descobrir se era modelo inexistente, quota estourada
   * ou campo rejeitado era preciso abrir o log do painel — o que na pratica
   * significava nao descobrir. O codigo de razao do Google (NOT_FOUND,
   * RESOURCE_EXHAUSTED, INVALID_ARGUMENT, PERMISSION_DENIED) nao e segredo e
   * responde a pergunta sozinho.
   */
  get resumo(): string {
    const g = corpoDeErro(this.detail)
    const partes = [`HTTP ${this.status}`]
    if (g?.status) partes.push(g.status)
    if (g?.message) partes.push(g.message.slice(0, 300))
    return partes.join(' · ')
  }
}

/** Le o envelope `{ error: { code, message, status } }` do Google. */
function corpoDeErro(detail: unknown): { message?: string; status?: string } | null {
  if (!detail) return null
  let payload: unknown = detail
  if (typeof detail === 'string') {
    try {
      payload = JSON.parse(detail)
    } catch {
      return { message: detail.slice(0, 300) }
    }
  }
  const erro = (payload as { error?: { message?: string; status?: string } })?.error
  if (!erro) return null
  return { message: erro.message, status: erro.status }
}

/**
 * O modelo gastou o teto de saida sem escrever a resposta.
 *
 * Acontece porque thinking sai da MESMA cota de maxOutputTokens que o texto:
 * com o teto baixo, o modelo pensa, estoura e devolve `parts` vazio com
 * finishReason=MAX_TOKENS. Como o projeto usa responseMimeType JSON, isso
 * chegava como "JSON invalido" ou "conteudo vazio" — mensagens que apontam
 * para o lugar errado.
 */
export class GeminiSemSaidaError extends Error {
  constructor(
    readonly maxOutputTokens: number,
    readonly thoughtTokens: number,
  ) {
    super(
      `O modelo consumiu o teto de ${maxOutputTokens} tokens de saida ` +
        `(${thoughtTokens} deles pensando) sem terminar a resposta.`,
    )
    this.name = 'GeminiSemSaidaError'
  }
}

/**
 * Erro dedicado para quando o modelo para por filtro de conteudo.
 *
 * Mesmo com os filtros configuraveis desligados, o provedor mantem barreiras
 * proprias que nao se desativam por parametro. O jogador precisa de mensagem
 * clara em vez de tela vazia.
 */
export class GeminiBlockedError extends Error {
  constructor(readonly finishReason: string) {
    super(`Geracao interrompida pelo provedor (${finishReason}).`)
    this.name = 'GeminiBlockedError'
  }
}

// ---------------------------------------------------------------------------
// Safety
//
// O sistema roda dark fantasy, temas maduros e romance denso, entao os filtros
// configuraveis ficam no minimo. Duas ressalvas honestas:
//
// 1. O provedor mantem barreiras nao desativaveis por parametro. Isto reduz
//    bloqueio, nao elimina.
// 2. A documentacao avisa que aplicacoes com configuracao menos restritiva
//    podem passar por revisao.
//
// HARM_CATEGORY_JAILBREAK aparece na referencia da API mas nao na pagina de
// safety settings; fica fora da lista padrao para nao arriscar 400.
// ---------------------------------------------------------------------------
const DEFAULT_HARM_CATEGORIES = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
  'HARM_CATEGORY_CIVIC_INTEGRITY',
]

function safetySettings(): Array<{ category: string; threshold: string }> {
  // OFF desliga o filtro; BLOCK_NONE apenas sempre mostra. OFF e mais forte.
  const threshold = Deno.env.get('GEMINI_SAFETY_THRESHOLD') ?? 'OFF'
  const categories =
    Deno.env
      .get('GEMINI_HARM_CATEGORIES')
      ?.split(',')
      .map((c) => c.trim())
      .filter(Boolean) ?? DEFAULT_HARM_CATEGORIES
  return categories.map((category) => ({ category, threshold }))
}

/** Uma pagina de PDF equivale a 258 tokens de entrada. */
export const TOKENS_POR_PAGINA_PDF = 258

/**
 * Bytes -> base64 para `inlineData`.
 *
 * Em blocos porque `String.fromCharCode` com spread estoura a pilha em arquivo
 * grande — e aqui os arquivos sao livros de centenas de paginas.
 */
export function bytesParaBase64(bytes: Uint8Array): string {
  let bin = ''
  const BLOCO = 0x8000
  for (let i = 0; i < bytes.length; i += BLOCO) {
    bin += String.fromCharCode(...bytes.subarray(i, i + BLOCO))
  }
  return btoa(bin)
}

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } }

export interface Conteudo {
  role: 'user' | 'model'
  /** Atalho para uma unica parte de texto. */
  text?: string
  /** Usado quando ha PDF ou imagem junto. Tem precedencia sobre `text`. */
  parts?: Part[]
}

export interface GenerateOptions {
  model: string
  systemInstruction?: string
  /** Partes do prompt, da mais estavel para a mais volatil (ajuda o cache). */
  contents: Conteudo[]
  responseSchema?: unknown
  temperature?: number
  maxOutputTokens?: number
  /** minimal | low | medium | high. Thinking e cobrado como output. */
  thinkingLevel?: string
  /** Nome do cache explicito, formato `cachedContents/<id>`. */
  cachedContent?: string
  signal?: AbortSignal
}

type ThinkingVariant = 'thinkingLevel' | 'thinkingConfig' | 'none'

/**
 * Teto de saida padrao.
 *
 * Era 2048 e isso e apertado demais quando thinking esta ligado: os tokens de
 * raciocinio saem da MESMA cota do texto, então o modelo podia estourar o teto
 * pensando e devolver resposta vazia. Subir o teto nao custa nada — a cobranca
 * e pelos tokens gerados, nao pelo limite declarado.
 */
const MAX_OUTPUT_PADRAO = 4096

function buildBody(
  opts: GenerateOptions,
  variant: ThinkingVariant,
): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    temperature: opts.temperature ?? 0.9,
    maxOutputTokens: opts.maxOutputTokens ?? MAX_OUTPUT_PADRAO,
  }

  if (opts.responseSchema) {
    generationConfig.responseMimeType = 'application/json'
    generationConfig.responseSchema = opts.responseSchema
  }

  // A documentacao do generateContent nao confirma o nome do campo de thinking
  // (a pagina de thinking descreve a Interactions API). Tentamos a variante
  // mais provavel e recuamos no 400 — ver generateStructured() abaixo.
  if (opts.thinkingLevel) {
    if (variant === 'thinkingLevel') {
      generationConfig.thinkingLevel = opts.thinkingLevel
    } else if (variant === 'thinkingConfig') {
      generationConfig.thinkingConfig = { thinkingLevel: opts.thinkingLevel }
    }
  }

  const body: Record<string, unknown> = {
    contents: opts.contents.map((c) => ({
      role: c.role,
      parts: c.parts ?? [{ text: c.text ?? '' }],
    })),
    generationConfig,
    safetySettings: safetySettings(),
  }

  if (opts.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] }
  }
  if (opts.cachedContent) {
    body.cachedContent = opts.cachedContent
  }

  return body
}

function apiKey(): string {
  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) {
    throw new GeminiError('GEMINI_API_KEY nao configurada nesta Edge Function.', 500)
  }
  return key
}

function extractUsage(payload: Record<string, any>): GeminiUsage {
  const u = payload.usageMetadata ?? {}
  return {
    promptTokens: u.promptTokenCount ?? 0,
    outputTokens: u.candidatesTokenCount ?? 0,
    thoughtTokens: u.thoughtsTokenCount ?? u.totalThoughtTokens ?? 0,
    cachedTokens: u.cachedContentTokenCount ?? u.totalCachedTokens ?? 0,
  }
}

/** Permite apontar para um stub local nos testes, sem tocar a API de verdade. */
function endpoint(model: string): string {
  const base = Deno.env.get('GEMINI_API_BASE') ?? API_BASE
  return `${base}/models/${model}:generateContent`
}

const THINKING_FALLBACK: ThinkingVariant[] = ['thinkingLevel', 'thinkingConfig', 'none']

/**
 * Gera conteudo estruturado. Com responseSchema, o retorno ja vem parseado.
 */
export async function generateStructured<T>(
  opts: GenerateOptions,
): Promise<GeminiResult<T>> {
  const variants: ThinkingVariant[] = opts.thinkingLevel ? THINKING_FALLBACK : ['none']
  const teto = opts.maxOutputTokens ?? MAX_OUTPUT_PADRAO
  let ultimoErro: string | undefined
  let semSaida: GeminiSemSaidaError | undefined

  for (const variant of variants) {
    const res = await fetch(endpoint(opts.model), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey(),
      },
      body: JSON.stringify(buildBody(opts, variant)),
      signal: opts.signal ?? null,
    })

    if (res.status === 400) {
      const text = await res.text()
      ultimoErro = text
      // Campo de thinking rejeitado: tenta a proxima forma.
      // Qualquer outro 400 e erro real e nao se resolve tentando de novo.
      if (/thinking/i.test(text) && variant !== 'none') continue
      throw new GeminiError('Requisicao rejeitada pelo Gemini.', 400, text)
    }

    if (!res.ok) {
      throw new GeminiError(
        `Gemini respondeu ${res.status}.`,
        res.status,
        await res.text(),
      )
    }

    const payload = await res.json()
    const candidate = payload.candidates?.[0]
    const finishReason: string = candidate?.finishReason ?? 'UNKNOWN'
    const usage = extractUsage(payload)

    if (!candidate || (finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS')) {
      throw new GeminiBlockedError(finishReason)
    }

    const text: string =
      candidate.content?.parts?.map((p: any) => p.text ?? '').join('') ?? ''

    // 200 com texto vazio: o modelo estourou o teto de saida antes de escrever.
    // Se ainda ha variante de thinking pela frente, a proxima tentativa gasta
    // menos raciocinio e tende a caber — a ultima e sempre 'none'.
    if (!text.trim()) {
      if (finishReason === 'MAX_TOKENS' || usage.thoughtTokens > 0) {
        semSaida = new GeminiSemSaidaError(teto, usage.thoughtTokens)
        if (variant !== 'none') continue
        throw semSaida
      }
      throw new GeminiError('Gemini devolveu conteudo vazio.', 502, payload)
    }

    let data: T
    try {
      data = JSON.parse(text) as T
    } catch {
      // Com responseSchema isto nao deveria acontecer. Guardar o texto cru
      // diagnostica melhor que "JSON invalido".
      throw new GeminiError('Gemini devolveu JSON invalido.', 502, text.slice(0, 500))
    }

    return { data, usage, model: opts.model, finishReason }
  }

  // Sair do laco sem retorno significa que nenhuma variante serviu. Distinguir
  // as duas causas importa: campo rejeitado e problema de contrato da API,
  // resposta vazia e problema de orcamento de tokens.
  if (semSaida) throw semSaida

  throw new GeminiError(
    'Nenhuma variante de configuracao de thinking foi aceita.',
    400,
    ultimoErro,
  )
}

// ---------------------------------------------------------------------------
// Geracao de imagem.
//
// ATENCAO: a documentacao de image generation descreve a Interactions API
// (POST /v1beta/interactions com response_format), que e diferente do
// generateContent usado acima. Este caminho e o UNICO do projeto que nao foi
// verificado contra a API real — os testes cobrem a montagem do payload e o
// tratamento da resposta, com stub.
//
// A extracao da imagem tolera os dois formatos conhecidos (output_image da
// Interactions API e inlineData de candidates, do generateContent), para nao
// quebrar se o endpoint responder no formato antigo.
// ---------------------------------------------------------------------------

export interface ImageOptions {
  model: string
  prompt: string
  /** 1:1, 3:2, 16:9, 9:16, ... */
  aspectRatio?: string
  /** 512px (0.5K) | 1K | 2K | 4K */
  imageSize?: string
  mimeType?: 'image/jpeg' | 'image/png'
  signal?: AbortSignal
}

export interface ImageResult {
  /** Bytes da imagem, ja decodificados de base64. */
  bytes: Uint8Array
  mimeType: string
}

function base64ParaBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** Procura a imagem nos dois formatos de resposta possiveis. */
function extrairImagem(
  payload: Record<string, any>,
): { data: string; mimeType: string } | null {
  const direto = payload.output_image ?? payload.outputImage
  if (direto?.data) {
    return {
      data: direto.data,
      mimeType: direto.mime_type ?? direto.mimeType ?? 'image/jpeg',
    }
  }

  const partes = payload.candidates?.[0]?.content?.parts ?? []
  for (const p of partes) {
    const inline = p.inlineData ?? p.inline_data
    if (inline?.data) {
      return {
        data: inline.data,
        mimeType: inline.mimeType ?? inline.mime_type ?? 'image/jpeg',
      }
    }
  }
  return null
}

export async function generateImage(opts: ImageOptions): Promise<ImageResult> {
  const base = Deno.env.get('GEMINI_API_BASE') ?? API_BASE
  const mimeType = opts.mimeType ?? 'image/jpeg'

  const res = await fetch(`${base}/interactions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey(),
    },
    body: JSON.stringify({
      model: opts.model,
      input: [{ type: 'text', text: opts.prompt }],
      response_format: {
        type: 'image',
        mime_type: mimeType,
        aspect_ratio: opts.aspectRatio ?? '16:9',
        image_size: opts.imageSize ?? '1K',
      },
    }),
    signal: opts.signal ?? null,
  })

  if (!res.ok) {
    throw new GeminiError(
      `Geracao de imagem respondeu ${res.status}.`,
      res.status,
      await res.text(),
    )
  }

  const payload = await res.json()
  const imagem = extrairImagem(payload)
  if (!imagem) {
    throw new GeminiError('Resposta de imagem sem dados reconheciveis.', 502, payload)
  }

  return { bytes: base64ParaBytes(imagem.data), mimeType: imagem.mimeType }
}
