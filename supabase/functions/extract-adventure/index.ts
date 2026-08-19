// Fabrica de campanhas: aventura em texto ou PDF -> JSON estrito em tabelas.
//
// O mestre cola um resumo, cola o texto integral OU envia o PDF do modulo de
// aventura; o modelo extrai locais, NPCs, itens, faccoes e eventos. O resultado
// alimenta o prompt de cada turno via `aventuraMd` (_shared/context.ts).
//
// O caminho de PDF existe porque colar um modulo de aventura inteiro a mao nao
// e um fluxo real: quem tem o material tem o arquivo. O PDF e apagado depois de
// lido, pela mesma razao da ingestao de regras — o que importa e o extrato.
//
// Roda uma vez por aventura. Reexecutar substitui as entidades anteriores.

import { erro, erroDoModelo, json, preflight } from '../_shared/http.ts'
import { bytesParaBase64, generateStructured, type Conteudo } from '../_shared/gemini.ts'
import {
  EXTRACAO_SCHEMA,
  paresParaObjeto,
  type ExtracaoResponse,
} from '../_shared/schemas.ts'
import {
  RespostaDeErro,
  autenticar,
  exigirMestre,
  exigirTexto,
  lerJson,
} from '../_shared/request.ts'

const MODELO_PADRAO = 'gemini-3.7-flash'

/** ~250 mil caracteres. Acima disso, o mestre divide a aventura. */
const MAX_CARACTERES = 250_000

/** Teto de entidades por aventura, para uma extracao desgovernada nao inundar o banco. */
const MAX_ENTIDADES = 200

const INSTRUCAO = `Voce extrai a estrutura de uma aventura de RPG a partir de texto solto.

Devolva as entidades que o Mestre vai precisar em jogo:
- location: lugares onde algo acontece. Inclua saidas e o que ha de perigoso.
- npc: pessoas com nome. Inclua atitude inicial, objetivo e, se houver, segredo.
- item: objetos que importam a trama.
- faction: grupos com interesse proprio.
- event: o que acontece por conta propria, com ou sem o jogador.

Regras:
- Extraia apenas o que esta no texto. Nao invente nome, lugar ou reviravolta.
- Se o texto for vago sobre algo, registre o que ha e omita o resto.
- Nomes exatamente como aparecem no texto.
- O plot_digest e para o Mestre ler antes de narrar, nao para o jogador.
- Recebendo um PDF, ignore capa, ficha tecnica, creditos, indice e tabelas de
  regras: o que interessa e a aventura.`

/** Limite do provedor e 50 MB; ficamos abaixo por seguranca, como na ingestao. */
const MAX_BYTES_PDF = 40 * 1024 * 1024

interface Corpo {
  adventure_id?: string
  /** Se vier, substitui o source_text guardado antes de extrair. */
  source_text?: string
  /**
   * Caminho de um PDF ja enviado ao bucket `rulebooks`. Tem precedencia sobre
   * source_text: quem manda o arquivo quer que ele seja a fonte.
   */
  source_pdf_path?: string
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return erro(req, 'Use POST.', 405)

  try {
    const ctx = await autenticar(req)
    await exigirMestre(ctx)

    const corpo = await lerJson<Corpo>(req)
    const adventureId = exigirTexto(corpo.adventure_id, 'adventure_id', 64)

    const pdfPath = corpo.source_pdf_path?.trim()

    if (!pdfPath && corpo.source_text !== undefined) {
      const texto = exigirTexto(corpo.source_text, 'source_text', MAX_CARACTERES)
      await ctx.comoServico
        .from('adventures')
        .update({ source_text: texto })
        .eq('id', adventureId)
    }

    const { data: aventura } = await ctx.comoServico
      .from('adventures')
      .select('id, title, synopsis, source_text')
      .eq('id', adventureId)
      .single()

    if (!aventura) throw new RespostaDeErro(404, 'Aventura nao encontrada.')
    if (!pdfPath && !aventura.source_text?.trim()) {
      throw new RespostaDeErro(
        409,
        'Esta aventura nao tem fonte. Envie source_text ou source_pdf_path nesta chamada.',
      )
    }

    // --- monta a fonte. PDF tem precedencia: quem enviou o arquivo quer que
    // ele seja a fonte, nao um texto colado antes.
    let fonte: Conteudo
    let bytesDoPdf = 0

    if (pdfPath) {
      const { data: arquivo, error: dlErro } = await ctx.comoServico.storage
        .from('rulebooks')
        .download(pdfPath)

      if (dlErro || !arquivo) {
        throw new RespostaDeErro(404, 'PDF nao encontrado no Storage.', dlErro?.message)
      }

      const bytes = new Uint8Array(await arquivo.arrayBuffer())
      bytesDoPdf = bytes.length
      if (bytes.length > MAX_BYTES_PDF) {
        throw new RespostaDeErro(
          413,
          `PDF de ${(bytes.length / 1048576).toFixed(1)} MB excede o limite de 40 MB. ` +
            'Divida o arquivo em partes.',
        )
      }

      fonte = {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'application/pdf', data: bytesParaBase64(bytes) } },
          { text: `# aventura: ${aventura.title}` },
        ],
      }
    } else {
      fonte = {
        role: 'user',
        text: `# aventura: ${aventura.title}\n\n${aventura.source_text}`,
      }
    }

    const resultado = await generateStructured<ExtracaoResponse>({
      model: Deno.env.get('GEMINI_MODEL_EXTRACT') ?? MODELO_PADRAO,
      systemInstruction: INSTRUCAO,
      contents: [fonte, { role: 'user', text: 'Extraia a estrutura desta aventura.' }],
      responseSchema: EXTRACAO_SCHEMA,
      // Extracao fiel exige atencao ao texto; roda uma vez por aventura.
      thinkingLevel: Deno.env.get('GEMINI_THINKING_EXTRACT') ?? 'medium',
      temperature: 0.2,
      maxOutputTokens: 8192,
    })

    const entidades = (resultado.data.entities ?? []).slice(0, MAX_ENTIDADES)
    const truncou = (resultado.data.entities ?? []).length > MAX_ENTIDADES

    // Substitui: reexecutar nao deve duplicar entidade.
    await ctx.comoServico
      .from('adventure_entities')
      .delete()
      .eq('adventure_id', adventureId)

    if (entidades.length) {
      const { error: insErro } = await ctx.comoServico.from('adventure_entities').insert(
        entidades
          .filter((e) => e.name?.trim())
          .map((e) => ({
            adventure_id: adventureId,
            kind: e.kind,
            name: e.name.trim(),
            summary: e.summary ?? null,
            data: paresParaObjeto(e.data),
          })),
      )
      if (insErro) throw new Error(`Falha ao gravar entidades: ${insErro.message}`)
    }

    // Sinopse e titulo do documento so preenchem o que esta VAZIO. Extraindo de
    // PDF o mestre nao digitou nada e agradece a sugestao; se ele escreveu algo,
    // a extracao nao tem por que sobrescrever.
    const campos: Record<string, unknown> = { plot_digest: resultado.data.plot_digest }
    if (!aventura.synopsis?.trim() && resultado.data.synopsis?.trim()) {
      campos.synopsis = resultado.data.synopsis.trim()
    }

    await ctx.comoServico.from('adventures').update(campos).eq('id', adventureId)

    // --- apaga o PDF: o extrato e o que importa daqui em diante, e o plano
    // free tem 1 GB de Storage. Mesma decisao da ingestao de regras.
    let pdfApagado = false
    if (pdfPath) {
      const { error: rmErro } = await ctx.comoServico.storage
        .from('rulebooks')
        .remove([pdfPath])
      if (rmErro)
        console.error('falha ao apagar o PDF da aventura', pdfPath, rmErro.message)
      else pdfApagado = true
    }

    await ctx.comoServico.rpc('record_turn_tokens', {
      p_user: ctx.userId,
      p_tokens_input: resultado.usage.promptTokens,
      p_tokens_output: resultado.usage.outputTokens + resultado.usage.thoughtTokens,
      p_images: 0,
    })

    const porTipo: Record<string, number> = {}
    for (const e of entidades) porTipo[e.kind] = (porTipo[e.kind] ?? 0) + 1

    return json(req, {
      adventure_id: adventureId,
      plot_digest: resultado.data.plot_digest,
      synopsis: (campos.synopsis as string | undefined) ?? null,
      entities_count: entidades.length,
      entities_by_kind: porTipo,
      // Truncamento silencioso leria como "extraiu tudo"; melhor dizer.
      truncated: truncou,
      source: pdfPath ? 'pdf' : 'texto',
      pdf_bytes: bytesDoPdf || null,
      pdf_deleted: pdfApagado,
      usage: resultado.usage,
    })
  } catch (e) {
    if (e instanceof RespostaDeErro) return erro(req, e.message, e.status, e.extra)
    const doModelo = erroDoModelo(req, e, 'extrair a aventura')
    if (doModelo) return doModelo
    console.error('extract-adventure', e)
    return erro(req, 'Erro inesperado na extracao.', 500)
  }
})
