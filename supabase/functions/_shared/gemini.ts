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

// ---------------------------------------------------------------------------
// Thinking — o que a API REAL aceita
//
// Medido com scripts/probe-gemini.mjs contra gemini-3.7-flash, nao deduzido da
// documentacao:
//
//   generationConfig.thinkingLevel            -> 400 Unknown name "thinkingLevel"
//                                                at 'generation_config'
//   generationConfig.thinkingConfig.budget    -> 200 STOP, resposta completa
//   generationConfig.thinkingConfig.level     -> inconclusivo (caiu em 503)
//
// Ou seja: `thinkingLevel` no topo do generationConfig, que era a primeira
// tentativa do cliente, NAO existe. Toda chamada com thinking comecava
// queimando uma requisicao num 400 garantido — e num modelo disputado isso
// multiplicava a chance de esbarrar num 503 nas tentativas seguintes.
//
// A ordem agora comeca pela forma comprovada. `thinkingConfig.thinkingLevel`
// fica como segunda tentativa porque o 503 nao permitiu descartar, e porque a
// Interactions API usa esse nome — se a API convergir para ele, o cliente
// acompanha sem mudanca.
// ---------------------------------------------------------------------------
type ThinkingVariant = 'budget' | 'level' | 'none'

/**
 * Nome do nivel -> orcamento de tokens de raciocinio.
 *
 * O projeto raciocina em niveis (`low` para narrar, `medium` para ler um livro)
 * porque e assim que a decisao de custo esta escrita no CLAUDE.md. A API cobra
 * thinking como output, então o nivel vira teto de tokens: e o mesmo controle,
 * expresso na unidade que o `generateContent` entende.
 */
const ORCAMENTO_POR_NIVEL: Record<string, number> = {
  none: 0,
  minimal: 128,
  low: 512,
  medium: 2048,
  high: 8192,
}

function orcamentoDeThinking(nivel: string): number {
  return ORCAMENTO_POR_NIVEL[nivel.toLowerCase()] ?? ORCAMENTO_POR_NIVEL.low!
}

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

  if (opts.thinkingLevel) {
    if (variant === 'budget') {
      generationConfig.thinkingConfig = {
        thinkingBudget: orcamentoDeThinking(opts.thinkingLevel),
      }
    } else if (variant === 'level') {
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

const THINKING_FALLBACK: ThinkingVariant[] = ['budget', 'level', 'none']

// ---------------------------------------------------------------------------
// Retry
//
// Esta era a falha que derrubava o jogo. A sonda mediu 503 "This model is
// currently experiencing high demand" em metade das chamadas a
// gemini-3.7-flash. O cliente tratava qualquer status nao-400 como definitivo e
// lancava na hora — um pico de demanda de segundos virava turno perdido, e o
// jogador via "Falha ao consultar o mestre" sem nenhuma pista.
//
// O proprio provedor diz que o pico e temporario. Entao vale esperar: tres
// tentativas com espera crescente resolvem o caso comum sem transformar
// indisponibilidade real em requisicao pendurada.
// ---------------------------------------------------------------------------
const STATUS_QUE_VALE_REPETIR = new Set([429, 500, 502, 503, 504])
const TENTATIVAS = 3
const ESPERA_BASE_MS = 700

/** Espera crescente com jitter, para N chamadas simultaneas nao voltarem juntas. */
function esperar(tentativa: number): Promise<void> {
  const base = ESPERA_BASE_MS * 2 ** tentativa
  return new Promise((r) => setTimeout(r, base + Math.random() * 300))
}

/**
 * O modelo esta sobrecarregado, nao ha nada errado com a requisicao.
 *
 * Existe separado de GeminiError porque a acao do usuario e diferente: nao ha o
 * que reformular, e so tentar de novo. Dizer "falha ao gerar" para um 503 manda
 * o jogador procurar problema onde nao tem.
 */
export class GeminiSobrecargaError extends Error {
  constructor(
    readonly status: number,
    readonly tentativas: number,
  ) {
    super(
      `O modelo esta sobrecarregado (HTTP ${status}) e nao respondeu em ` +
        `${tentativas} tentativas. Isso costuma passar em alguns segundos.`,
    )
    this.name = 'GeminiSobrecargaError'
  }
}

/**
 * POST no endpoint, repetindo o que vale repetir.
 *
 * Devolve a resposta, inclusive quando ela e 400 — 400 e problema do payload e
 * repetir nao muda nada. Somente 429 e 5xx entram no laco.
 */
async function postarComRetry(
  url: string,
  corpo: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  let ultimoStatus = 0

  for (let tentativa = 0; tentativa < TENTATIVAS; tentativa++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey() },
      body: JSON.stringify(corpo),
      signal: signal ?? null,
    })

    if (!STATUS_QUE_VALE_REPETIR.has(res.status)) return res

    ultimoStatus = res.status
    // O corpo precisa ser consumido antes da proxima tentativa.
    const detalhe = await res.text()
    console.warn(
      `gemini/retry tentativa ${tentativa + 1}/${TENTATIVAS} status ${res.status}`,
      detalhe.slice(0, 200),
    )

    if (tentativa < TENTATIVAS - 1) await esperar(tentativa)
  }

  throw new GeminiSobrecargaError(ultimoStatus, TENTATIVAS)
}

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
    const res = await postarComRetry(
      endpoint(opts.model),
      buildBody(opts, variant),
      opts.signal,
    )

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

  // Mesmo retry do texto: imagem sai de modelo disputado tambem, e um 503 aqui
  // consumia quota de imagem do jogador por um pico de segundos.
  const res = await postarComRetry(
    `${base}/interactions`,
    {
      model: opts.model,
      input: [{ type: 'text', text: opts.prompt }],
      response_format: {
        type: 'image',
        mime_type: mimeType,
        aspect_ratio: opts.aspectRatio ?? '16:9',
        image_size: opts.imageSize ?? '1K',
      },
    },
    opts.signal,
  )

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
