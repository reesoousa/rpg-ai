// Fabrica de campanhas: texto solto de aventura -> JSON estrito em tabelas.
//
// O mestre cola um resumo ou o texto de uma aventura; o modelo extrai locais,
// NPCs, itens, faccoes e eventos. O resultado alimenta o estado_do_mundo.md
// enviado no prompt de cada turno.
//
// Roda uma vez por aventura. Reexecutar substitui as entidades anteriores.

import { erro, json, preflight } from '../_shared/http.ts'
import { GeminiBlockedError, GeminiError, generateStructured } from '../_shared/gemini.ts'
import { EXTRACAO_SCHEMA, paresParaObjeto, type ExtracaoResponse } from '../_shared/schemas.ts'
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
- O plot_digest e para o Mestre ler antes de narrar, nao para o jogador.`

interface Corpo {
  adventure_id?: string
  /** Se vier, substitui o source_text guardado antes de extrair. */
  source_text?: string
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

    if (corpo.source_text !== undefined) {
      const texto = exigirTexto(corpo.source_text, 'source_text', MAX_CARACTERES)
      await ctx.comoServico
        .from('adventures')
        .update({ source_text: texto })
        .eq('id', adventureId)
    }

    const { data: aventura } = await ctx.comoServico
      .from('adventures')
      .select('id, title, source_text')
      .eq('id', adventureId)
      .single()

    if (!aventura) throw new RespostaDeErro(404, 'Aventura nao encontrada.')
    if (!aventura.source_text?.trim()) {
      throw new RespostaDeErro(
        409,
        'Esta aventura nao tem texto de origem. Envie source_text nesta chamada.',
      )
    }

    const resultado = await generateStructured<ExtracaoResponse>({
      model: Deno.env.get('GEMINI_MODEL_EXTRACT') ?? MODELO_PADRAO,
      systemInstruction: INSTRUCAO,
      contents: [
        { role: 'user', text: `# aventura: ${aventura.title}\n\n${aventura.source_text}` },
        { role: 'user', text: 'Extraia a estrutura desta aventura.' },
      ],
      responseSchema: EXTRACAO_SCHEMA,
      // Extracao fiel exige atencao ao texto; roda uma vez por aventura.
      thinkingLevel: Deno.env.get('GEMINI_THINKING_EXTRACT') ?? 'medium',
      temperature: 0.2,
      maxOutputTokens: 8192,
    })

    const entidades = (resultado.data.entities ?? []).slice(0, MAX_ENTIDADES)
    const truncou = (resultado.data.entities ?? []).length > MAX_ENTIDADES

    // Substitui: reexecutar nao deve duplicar entidade.
    await ctx.comoServico.from('adventure_entities').delete().eq('adventure_id', adventureId)

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

    await ctx.comoServico
      .from('adventures')
      .update({ plot_digest: resultado.data.plot_digest })
      .eq('id', adventureId)

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
      entities_count: entidades.length,
      entities_by_kind: porTipo,
      // Truncamento silencioso leria como "extraiu tudo"; melhor dizer.
      truncated: truncou,
      usage: resultado.usage,
    })
  } catch (e) {
    if (e instanceof RespostaDeErro) return erro(req, e.message, e.status, e.extra)
    if (e instanceof GeminiBlockedError) {
      return erro(req, 'O provedor interrompeu a extracao deste texto.', 422)
    }
    if (e instanceof GeminiError) {
      console.error('gemini', e.status, e.message, e.detail)
      return erro(req, 'Falha ao extrair a aventura.', 502)
    }
    console.error('extract-adventure', e)
    return erro(req, 'Erro inesperado na extracao.', 500)
  }
})
