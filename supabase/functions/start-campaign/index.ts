// Abre uma campanha: cria campanha, ficha, estado do mundo e o turno de
// abertura, tudo numa chamada.
//
// A abertura e gerada pelo modelo porque a primeira cena define o tom da
// campanha inteira — deixar isso como texto fixo empobreceria o jogo.

import { erro, erroDoModelo, json, preflight } from '../_shared/http.ts'
import { generateStructured } from '../_shared/gemini.ts'
import {
  MAX_ENTIDADES_NO_PROMPT,
  SYSTEM_INSTRUCTION,
  aventuraMd,
  type Entidade,
} from '../_shared/context.ts'
import {
  ABERTURA_SCHEMA,
  paresParaObjeto,
  type AberturaResponse,
} from '../_shared/schemas.ts'
import {
  RespostaDeErro,
  autenticar,
  exigirTexto,
  lerJson,
  reservarQuota,
} from '../_shared/request.ts'

const MODELO_PADRAO = 'gemini-3.7-flash'

interface Corpo {
  system_id?: string
  adventure_id?: string | null
  title?: string
  character?: {
    name?: string
    concept?: string
    hp_max?: number
    attributes?: Array<{ key: string; value: string }> | Record<string, unknown>
    skills?: string[]
    inventory?: string[]
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return erro(req, 'Use POST.', 405)

  try {
    const ctx = await autenticar(req)
    const corpo = await lerJson<Corpo>(req)

    const systemId = exigirTexto(corpo.system_id, 'system_id', 64)
    const title = exigirTexto(corpo.title, 'title', 120)
    const nome = exigirTexto(corpo.character?.name, 'character.name', 80)
    const conceito = exigirTexto(corpo.character?.concept, 'character.concept', 300)

    const hpMax = Number(corpo.character?.hp_max ?? 20)
    if (!Number.isInteger(hpMax) || hpMax < 1 || hpMax > 999) {
      throw new RespostaDeErro(400, 'character.hp_max deve ser um inteiro entre 1 e 999.')
    }

    // O sistema tem de existir e estar publicado — o select passa por RLS.
    const { data: sistema } = await ctx.comoUsuario
      .from('systems')
      .select('id, name')
      .eq('id', systemId)
      .single()
    if (!sistema)
      throw new RespostaDeErro(404, 'Sistema nao encontrado ou nao publicado.')

    // A checagem de existencia passa pelo cliente do usuario de proposito: a
    // policy exige aventura publicada, entao rascunho nao vira campanha.
    let aventura: { id: string; title: string; synopsis: string | null } | null = null
    let plotDigest: string | null = null
    let entidades: Entidade[] = []

    if (corpo.adventure_id) {
      const { data } = await ctx.comoUsuario
        .from('adventures')
        .select('id, title, synopsis')
        .eq('id', corpo.adventure_id)
        .single()
      if (!data)
        throw new RespostaDeErro(404, 'Aventura nao encontrada ou nao publicada.')
      aventura = data

      // plot_digest esta fora do grant do cliente; as entidades sao muitas.
      // As duas leituras vao por service_role, depois de a policy ja ter
      // confirmado que o usuario pode jogar esta aventura.
      const [digestRes, entidadesRes] = await Promise.all([
        ctx.comoServico
          .from('adventures')
          .select('plot_digest')
          .eq('id', data.id)
          .single(),
        ctx.comoServico
          .from('adventure_entities')
          .select('kind, name, summary, data')
          .eq('adventure_id', data.id)
          .order('kind')
          .limit(MAX_ENTIDADES_NO_PROMPT),
      ])

      plotDigest = digestRes.data?.plot_digest ?? null
      entidades = (entidadesRes.data ?? []) as Entidade[]
    }

    // Digest fica fora do grant do cliente: lido com service_role.
    const { data: digests } = await ctx.comoServico
      .from('systems')
      .select('rules_digest')
      .eq('id', systemId)
      .single()

    const { restante, devolver } = await reservarQuota(ctx, 'turn')

    let campaignId: string | null = null

    try {
      // --- cria a campanha pelo cliente do usuario: a policy exige
      // user_id = auth.uid(), então nao ha como criar campanha para outro.
      const { data: campanha, error: campErro } = await ctx.comoUsuario
        .from('campaigns')
        .insert({
          user_id: ctx.userId,
          system_id: systemId,
          adventure_id: aventura?.id ?? null,
          title,
        })
        .select('id')
        .single()

      if (campErro || !campanha) {
        throw new Error(`Falha ao criar campanha: ${campErro?.message}`)
      }
      campaignId = campanha.id

      const atributos = Array.isArray(corpo.character?.attributes)
        ? paresParaObjeto(corpo.character.attributes)
        : ((corpo.character?.attributes as Record<string, unknown>) ?? {})

      await ctx.comoUsuario.from('characters').insert({
        campaign_id: campaignId,
        name: nome,
        concept: conceito,
        hp_current: hpMax,
        hp_max: hpMax,
        attributes: atributos,
        skills: corpo.character?.skills ?? [],
        inventory: corpo.character?.inventory ?? [],
      })

      // --- abertura
      const contexto = [
        `# sistema.md\nSistema: ${sistema.name}`,
        digests?.rules_digest ? `\n## regras relevantes\n${digests.rules_digest}` : '',
        aventura
          ? `\n${aventuraMd({ ...aventura, plot_digest: plotDigest }, entidades)}`
          : '',
      ].join('')

      const ficha = `# personagem.md\nNome: ${nome}\nConceito: ${conceito}\nHP: ${hpMax}/${hpMax}`

      const resultado = await generateStructured<AberturaResponse>({
        model: Deno.env.get('GEMINI_MODEL_TURN') ?? MODELO_PADRAO,
        systemInstruction: SYSTEM_INSTRUCTION,
        contents: [
          { role: 'user', text: contexto },
          { role: 'user', text: ficha },
          {
            role: 'user',
            // Com aventura pronta, a abertura tem de aterrissar DENTRO dela.
            // Sem esta instrucao o modelo abre uma cena generica e a aventura
            // escolhida so aparece alguns turnos depois, por acaso.
            text: aventura
              ? '# turno_atual\nAbra esta aventura. Comece no primeiro lugar da lista de ' +
                'lugares, ou no que a trama indicar como ponto de partida, e coloque em ' +
                'cena quem estiver la. Estabeleca a tensao inicial da aventura. Nao resuma ' +
                'a premissa e nao antecipe reviravolta: mostre a cena.'
              : '# turno_atual\nAbra a campanha. Estabeleca o lugar, o momento e uma tensao ' +
                'imediata. Nao resuma a premissa: mostre a cena.',
          },
        ],
        responseSchema: ABERTURA_SCHEMA,
        thinkingLevel: Deno.env.get('GEMINI_THINKING_LEVEL') ?? 'low',
        temperature: 1.0,
      })

      await ctx.comoServico.from('world_state').insert({
        campaign_id: campaignId,
        current_location: resultado.data.location,
        location_description: resultado.data.location_description ?? null,
        present_npcs: resultado.data.present_npcs ?? [],
        weather: resultado.data.weather ?? null,
      })

      await ctx.comoServico.from('turns').insert({
        campaign_id: campaignId,
        seq: 1,
        turn_type: 'opening',
        player_input: null,
        narrative: resultado.data.narrative,
        state_delta: {},
        tokens_input: resultado.usage.promptTokens,
        tokens_output: resultado.usage.outputTokens + resultado.usage.thoughtTokens,
        model: resultado.model,
      })

      await ctx.comoServico
        .from('campaigns')
        .update({ last_turn_seq: 1 })
        .eq('id', campaignId)

      await ctx.comoServico.rpc('record_turn_tokens', {
        p_user: ctx.userId,
        p_tokens_input: resultado.usage.promptTokens,
        p_tokens_output: resultado.usage.outputTokens + resultado.usage.thoughtTokens,
        p_images: 0,
      })

      return json(req, {
        campaign_id: campaignId,
        seq: 1,
        narrative: resultado.data.narrative,
        location: resultado.data.location,
        quota: { turns_remaining: restante },
      })
    } catch (e) {
      await devolver()
      // Campanha sem abertura seria um registro morto no dashboard.
      if (campaignId) {
        await ctx.comoServico.from('campaigns').delete().eq('id', campaignId)
      }
      throw e
    }
  } catch (e) {
    if (e instanceof RespostaDeErro) return erro(req, e.message, e.status, e.extra)
    const doModelo = erroDoModelo(req, e, 'gerar a abertura')
    if (doModelo) return doModelo
    console.error('start-campaign', e)
    return erro(req, 'Erro inesperado ao abrir a campanha.', 500)
  }
})
