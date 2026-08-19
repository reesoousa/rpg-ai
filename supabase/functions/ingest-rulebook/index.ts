// Ingestao de livro de regras: PDF do Storage -> resumo operacional.
//
// Esta e a operacao mais cara do sistema. Cada pagina de PDF vale 258 tokens de
// entrada, então um livro de 400 paginas custa ~103 mil tokens numa unica
// chamada. Por isso: so o mestre executa, o tamanho e conferido antes, e o
// custo real fica registrado.
//
// Roda UMA VEZ por livro. O resultado (`digest`) e que vai no prompt de cada
// turno, no lugar do livro — e o que substitui o Context Caching explicito,
// cujo armazenamento por hora sairia por ~US$ 144/mes.

import { erro, erroDoModelo, json, preflight } from '../_shared/http.ts'
import {
  TOKENS_POR_PAGINA_PDF,
  bytesParaBase64,
  generateStructured,
} from '../_shared/gemini.ts'
import { DIGEST_SCHEMA, type DigestResponse } from '../_shared/schemas.ts'
import {
  RespostaDeErro,
  autenticar,
  exigirMestre,
  exigirTexto,
  lerJson,
} from '../_shared/request.ts'

const MODELO_PADRAO = 'gemini-3.7-flash'

/** Limite do provedor: 50 MB e 1000 paginas. Ficamos abaixo por seguranca. */
const MAX_BYTES = 40 * 1024 * 1024

const INSTRUCAO = `Voce le o livro de regras de um RPG de mesa e escreve um resumo OPERACIONAL.

O leitor do seu resumo e um Mestre que vai narrar partidas. Ele nao precisa do
texto do livro: precisa saber COMO USAR o sistema.

Inclua: como se rola dado, como se decide sucesso e falha, como funcionam dano,
cura e morte, que recursos o personagem gasta, quais condicoes existem e o que
elas fazem, e como se cria um personagem em linhas gerais.

Nao copie trechos do livro. Escreva instrucoes de uso, na sua propria redacao.
Se o livro nao trouxer alguma dessas informacoes, omita em vez de inventar.`

interface Corpo {
  rulebook_id?: string
  /** Opcional: publica o digest em systems.rules_digest ao terminar. */
  publish?: boolean
  /** Por padrao o PDF e apagado apos a ingestao. true mantem o arquivo. */
  keep_file?: boolean
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return erro(req, 'Use POST.', 405)

  try {
    const ctx = await autenticar(req)
    await exigirMestre(ctx)

    const corpo = await lerJson<Corpo>(req)
    const rulebookId = exigirTexto(corpo.rulebook_id, 'rulebook_id', 64)

    const { data: livro } = await ctx.comoServico
      .from('rulebooks')
      .select('id, system_id, title, storage_path, page_count')
      .eq('id', rulebookId)
      .single()
    if (!livro) throw new RespostaDeErro(404, 'Livro nao encontrado.')

    // O PDF e apagado apos a primeira ingestao. Reingerir exige subir de novo,
    // e o erro precisa dizer isso em vez de reclamar de arquivo ausente.
    if (!livro.storage_path) {
      throw new RespostaDeErro(
        409,
        'O PDF deste livro ja foi apagado apos a ingestao anterior. ' +
          'Envie o arquivo novamente para reingerir.',
      )
    }

    // --- baixa do Storage
    const { data: arquivo, error: dlErro } = await ctx.comoServico.storage
      .from('rulebooks')
      .download(livro.storage_path)

    if (dlErro || !arquivo) {
      throw new RespostaDeErro(404, 'PDF nao encontrado no Storage.', dlErro?.message)
    }

    const bytes = new Uint8Array(await arquivo.arrayBuffer())
    if (bytes.length > MAX_BYTES) {
      throw new RespostaDeErro(
        413,
        `PDF de ${(bytes.length / 1048576).toFixed(1)} MB excede o limite de 40 MB. ` +
          'Divida o arquivo em partes.',
      )
    }

    // Aviso de custo antes de gastar: com page_count conhecido, da para estimar.
    const custoEstimado = livro.page_count
      ? livro.page_count * TOKENS_POR_PAGINA_PDF
      : null

    const resultado = await generateStructured<DigestResponse>({
      model: Deno.env.get('GEMINI_MODEL_INGEST') ?? MODELO_PADRAO,
      systemInstruction: INSTRUCAO,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'application/pdf', data: bytesParaBase64(bytes) } },
            { text: `Livro: ${livro.title}. Escreva o resumo operacional.` },
          ],
        },
      ],
      responseSchema: DIGEST_SCHEMA,
      // Ler um livro inteiro justifica raciocinio: roda uma vez por livro.
      thinkingLevel: Deno.env.get('GEMINI_THINKING_INGEST') ?? 'medium',
      temperature: 0.4,
      maxOutputTokens: 4096,
    })

    const tokensOut = resultado.usage.outputTokens + resultado.usage.thoughtTokens

    await ctx.comoServico
      .from('rulebooks')
      .update({
        digest: resultado.data.digest,
        ingest_tokens_input: resultado.usage.promptTokens,
        ingest_tokens_output: tokensOut,
        ingested_at: new Date().toISOString(),
        original_size_bytes: bytes.length,
      })
      .eq('id', rulebookId)

    // --- apaga o PDF: o digest e o que importa daqui em diante.
    //
    // O plano free tem 1 GB de Storage e um livro come 20-40 MB. Guardar o
    // arquivo depois de extrair as regras nao serve a nada — reingerir exigiria
    // subir de novo, que e barato comparado a manter o arquivo parado.
    let apagado = false
    if (!corpo.keep_file) {
      const { error: rmErro } = await ctx.comoServico.storage
        .from('rulebooks')
        .remove([livro.storage_path])

      if (rmErro) {
        // Nao e motivo para falhar: o digest ja esta salvo. Fica registrado
        // para limpeza posterior.
        console.error('falha ao apagar o PDF', livro.storage_path, rmErro.message)
      } else {
        apagado = true
        await ctx.comoServico
          .from('rulebooks')
          .update({ storage_path: null, file_deleted_at: new Date().toISOString() })
          .eq('id', rulebookId)
      }
    }

    if (corpo.publish) {
      await ctx.comoServico
        .from('systems')
        .update({ rules_digest: resultado.data.digest })
        .eq('id', livro.system_id)
    }

    await ctx.comoServico.rpc('record_turn_tokens', {
      p_user: ctx.userId,
      p_tokens_input: resultado.usage.promptTokens,
      p_tokens_output: tokensOut,
      p_images: 0,
    })

    return json(req, {
      rulebook_id: rulebookId,
      digest: resultado.data.digest,
      system_name: resultado.data.system_name ?? null,
      dice_notation: resultado.data.dice_notation ?? null,
      published: Boolean(corpo.publish),
      file_deleted: apagado,
      original_size_bytes: bytes.length,
      usage: {
        ...resultado.usage,
        estimated_from_pages: custoEstimado,
      },
    })
  } catch (e) {
    if (e instanceof RespostaDeErro) return erro(req, e.message, e.status, e.extra)
    const doModelo = erroDoModelo(req, e, 'ler o livro')
    if (doModelo) return doModelo
    console.error('ingest-rulebook', e)
    return erro(req, 'Erro inesperado na ingestao.', 500)
  }
})
