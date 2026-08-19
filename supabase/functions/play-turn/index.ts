// Um turno de jogo.
//
// Fluxo, e a ordem importa:
//   autentica -> confere posse -> reserva quota -> chama o modelo -> grava
//
// A quota e reservada ANTES da chamada porque e ela que protege o custo. Se o
// modelo falhar depois, o credito e devolvido: o jogador nao paga por erro
// nosso, mas tambem nao consegue disparar chamadas sem serem contadas.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { erro, erroDoModelo, json, preflight } from '../_shared/http.ts'
import { generateStructured } from '../_shared/gemini.ts'
import {
  JANELA_DE_HISTORICO,
  MAX_ENTIDADES_NO_PROMPT,
  SYSTEM_INSTRUCTION,
  montarPrompt,
  type Entidade,
  type EstadoMundo,
  type Personagem,
  type TurnoAnterior,
} from '../_shared/context.ts'
import {
  TURN_RESPONSE_SCHEMA,
  sanitizeDelta,
  type TurnResponse,
} from '../_shared/turn-schema.ts'

const MODELO_PADRAO = 'gemini-3.7-flash'
// Thinking e cobrado como output; para narrar, "low" entrega sem inflar a conta.
const THINKING_PADRAO = 'low'

interface Corpo {
  campaign_id?: string
  turn_type?: 'speak' | 'act' | 'continue'
  player_input?: string
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre

  if (req.method !== 'POST') return erro(req, 'Use POST.', 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return erro(req, 'Falta o header Authorization.', 401)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Cliente do usuario: herda o JWT, entao RLS vale. Usado para tudo que o
  // jogador tem direito de ler.
  const comoUsuario = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  // Cliente privilegiado: usado apenas para gravar turno e mexer em quota,
  // que o cliente nao pode tocar por design.
  const comoServico = createClient(url, serviceKey)

  const { data: auth, error: authErro } = await comoUsuario.auth.getUser()
  if (authErro || !auth?.user) return erro(req, 'Sessao invalida.', 401)
  const userId = auth.user.id

  let corpo: Corpo
  try {
    corpo = await req.json()
  } catch {
    return erro(req, 'Corpo nao e JSON valido.', 400)
  }

  const { campaign_id: campaignId, turn_type: turnType } = corpo
  const playerInput = corpo.player_input?.trim()

  if (!campaignId) return erro(req, 'campaign_id e obrigatorio.', 400)
  if (turnType !== 'speak' && turnType !== 'act' && turnType !== 'continue') {
    return erro(req, 'turn_type deve ser speak, act ou continue.', 400)
  }
  if (turnType !== 'continue' && !playerInput) {
    return erro(req, 'player_input e obrigatorio para speak e act.', 400)
  }
  if (playerInput && playerInput.length > 2000) {
    return erro(req, 'player_input longo demais (max 2000 caracteres).', 400)
  }

  // --- posse: o select passa por RLS, entao campanha alheia simplesmente nao aparece
  const { data: campanha, error: campErro } = await comoUsuario
    .from('campaigns')
    .select('id, system_id, adventure_id, last_turn_seq, status')
    .eq('id', campaignId)
    .single()

  if (campErro || !campanha) return erro(req, 'Campanha nao encontrada.', 404)
  if (campanha.status !== 'active') return erro(req, 'Esta campanha nao esta ativa.', 409)

  // --- quota ANTES do modelo
  const { data: restante, error: quotaErro } = await comoServico.rpc(
    'consume_turn_quota',
    {
      p_user: userId,
    },
  )
  if (quotaErro) {
    const limite = /Limite diario/.test(quotaErro.message)
    return erro(
      req,
      limite ? quotaErro.message : 'Falha ao verificar quota.',
      limite ? 429 : 500,
    )
  }

  const devolverQuota = async () => {
    await comoServico.rpc('refund_turn_quota', { p_user: userId })
  }

  try {
    // --- estado
    const [sistemaRes, aventuraRes, entidadesRes, personagemRes, mundoRes, historicoRes] =
      await Promise.all([
        comoServico
          .from('systems')
          .select('name, rules_digest')
          .eq('id', campanha.system_id)
          .single(),
        // plot_digest e adventure_entities entram no prompt: sem eles o Mestre
        // narra uma aventura pronta sabendo apenas o titulo e a sinopse.
        campanha.adventure_id
          ? comoServico
              .from('adventures')
              .select('title, synopsis, plot_digest')
              .eq('id', campanha.adventure_id)
              .single()
          : Promise.resolve({ data: null, error: null }),
        campanha.adventure_id
          ? comoServico
              .from('adventure_entities')
              .select('kind, name, summary, data')
              .eq('adventure_id', campanha.adventure_id)
              .order('kind')
              .limit(MAX_ENTIDADES_NO_PROMPT)
          : Promise.resolve({ data: [], error: null }),
        comoUsuario.from('characters').select('*').eq('campaign_id', campaignId).single(),
        comoUsuario
          .from('world_state')
          .select('*')
          .eq('campaign_id', campaignId)
          .single(),
        comoUsuario
          .from('turns')
          .select('seq, turn_type, player_input, narrative')
          .eq('campaign_id', campaignId)
          .order('seq', { ascending: false })
          .limit(JANELA_DE_HISTORICO),
      ])

    if (!personagemRes.data) {
      await devolverQuota()
      return erro(req, 'Esta campanha ainda nao tem personagem.', 409)
    }
    if (!mundoRes.data) {
      await devolverQuota()
      return erro(req, 'Esta campanha ainda nao tem estado de mundo.', 409)
    }

    const personagem = personagemRes.data as Personagem
    const mundo = mundoRes.data as EstadoMundo

    const partes = montarPrompt({
      sistema: sistemaRes.data ?? { name: 'Sistema desconhecido' },
      aventura: aventuraRes.data,
      entidades: (entidadesRes.data ?? []) as Entidade[],
      personagem,
      mundo,
      historico: (historicoRes.data ?? []) as TurnoAnterior[],
      turnType,
      playerInput,
    })

    // --- modelo. Partes do mais estavel ao mais volatil: o cache implicito do
    // Gemini age sobre o prefixo do prompt.
    const resultado = await generateStructured<TurnResponse>({
      model: Deno.env.get('GEMINI_MODEL_TURN') ?? MODELO_PADRAO,
      systemInstruction: SYSTEM_INSTRUCTION,
      contents: [
        { role: 'user', text: partes.estavel },
        { role: 'user', text: partes.estado },
        { role: 'user', text: partes.volatil },
      ],
      responseSchema: TURN_RESPONSE_SCHEMA,
      thinkingLevel: Deno.env.get('GEMINI_THINKING_LEVEL') ?? THINKING_PADRAO,
      temperature: Number(Deno.env.get('GEMINI_TEMPERATURE') ?? '0.95'),
      maxOutputTokens: Number(Deno.env.get('GEMINI_MAX_OUTPUT') ?? '4096'),
    })

    const delta = sanitizeDelta(resultado.data.state_delta)
    const seq = campanha.last_turn_seq + 1

    // --- grava o turno. Somente service_role escreve aqui: narrativa forjada
    // pelo cliente corromperia o contexto dos turnos seguintes.
    const { error: turnoErro } = await comoServico.from('turns').insert({
      campaign_id: campaignId,
      seq,
      turn_type: turnType,
      player_input: playerInput ?? null,
      narrative: resultado.data.narrative,
      state_delta: delta,
      tokens_input: resultado.usage.promptTokens,
      // thinking sai da mesma conta que o output
      tokens_output: resultado.usage.outputTokens + resultado.usage.thoughtTokens,
      model: resultado.model,
    })
    if (turnoErro) throw new Error(`Falha ao gravar turno: ${turnoErro.message}`)

    await comoServico
      .from('campaigns')
      .update({ last_turn_seq: seq })
      .eq('id', campaignId)

    // --- aplica o delta na ficha
    const novoHp = Math.max(
      0,
      Math.min(personagem.hp_max, personagem.hp_current + delta.hp_change),
    )
    const inventario = aplicarInventario(
      personagem.inventory as string[],
      delta.inventory_add,
      delta.inventory_remove,
    )
    if (novoHp !== personagem.hp_current || inventario.mudou) {
      await comoServico
        .from('characters')
        .update({ hp_current: novoHp, inventory: inventario.lista })
        .eq('campaign_id', campaignId)
    }

    // --- avanca o mundo
    const relogio = new Date(mundo.world_clock)
    relogio.setUTCMinutes(relogio.getUTCMinutes() + delta.time_passed_minutes)

    await comoServico
      .from('world_state')
      .update({
        current_location: delta.current_location ?? mundo.current_location,
        location_description: delta.location_description ?? mundo.location_description,
        present_npcs: delta.present_npcs ?? mundo.present_npcs,
        weather: delta.weather ?? mundo.weather,
        world_clock: relogio.toISOString(),
        flags: aplicarFlags(mundo.flags, delta.flags_set),
      })
      .eq('campaign_id', campaignId)

    await comoServico.rpc('record_turn_tokens', {
      p_user: userId,
      p_tokens_input: resultado.usage.promptTokens,
      p_tokens_output: resultado.usage.outputTokens + resultado.usage.thoughtTokens,
      p_images: 0,
    })

    return json(req, {
      seq,
      narrative: resultado.data.narrative,
      state_delta: delta,
      suggested_actions: resultado.data.suggested_actions ?? [],
      character: { hp_current: novoHp, hp_max: personagem.hp_max },
      world_clock: relogio.toISOString(),
      quota: { turns_remaining: restante },
      usage: resultado.usage,
    })
  } catch (e) {
    // O jogador nao paga por falha nossa.
    await devolverQuota()

    const doModelo = erroDoModelo(req, e, 'consultar o mestre')
    if (doModelo) return doModelo
    console.error('play-turn', e)
    return erro(req, 'Erro inesperado ao processar o turno.', 500)
  }
})

function aplicarInventario(
  atual: string[] | undefined,
  adicionar?: string[],
  remover?: string[],
): { lista: string[]; mudou: boolean } {
  const lista = Array.isArray(atual) ? [...atual] : []
  const antes = JSON.stringify(lista)

  for (const item of adicionar ?? []) {
    if (item && !lista.includes(item)) lista.push(item)
  }
  for (const item of remover ?? []) {
    const i = lista.indexOf(item)
    if (i >= 0) lista.splice(i, 1)
  }

  return { lista, mudou: JSON.stringify(lista) !== antes }
}

function aplicarFlags(
  atuais: Record<string, unknown>,
  novas?: Array<{ key: string; value: string }>,
): Record<string, unknown> {
  const resultado = { ...(atuais ?? {}) }
  for (const { key, value } of novas ?? []) {
    if (key) resultado[key] = value
  }
  return resultado
}
