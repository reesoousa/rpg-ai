// Botao "Gerar Cena": estado do mundo -> imagem.
//
// O prompt da imagem e montado no codigo, a partir do estado do mundo e do
// ultimo turno. Nao ha chamada de texto ao modelo antes: seria dobrar o custo
// para escrever uma frase que o proprio estado ja descreve.
//
// Quota propria: imagem e cobrada por unidade, não por token, então o limite de
// turnos nao a protege.

import { erro, json, preflight } from '../_shared/http.ts'
import { GeminiError, generateImage } from '../_shared/gemini.ts'
import {
  RespostaDeErro,
  autenticar,
  exigirTexto,
  lerJson,
  reservarQuota,
} from '../_shared/request.ts'

const MODELO_PADRAO = 'gemini-3.1-flash-image'

/** URL assinada de 7 dias: a imagem aparece no historico do chat por um tempo. */
const VALIDADE_URL_SEGUNDOS = 60 * 60 * 24 * 7

interface Corpo {
  campaign_id?: string
  /** Sobrescreve o estilo padrao, se o jogador quiser outro. */
  style?: string
}

const ESTILO_PADRAO =
  'ilustracao digital, luz dramatica, composicao cinematografica, sem texto, sem interface'

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return erro(req, 'Use POST.', 405)

  try {
    const ctx = await autenticar(req)
    const corpo = await lerJson<Corpo>(req)
    const campaignId = exigirTexto(corpo.campaign_id, 'campaign_id', 64)
    const estilo = corpo.style ? exigirTexto(corpo.style, 'style', 200) : ESTILO_PADRAO

    // RLS resolve a posse: campanha alheia nao aparece.
    const { data: campanha } = await ctx.comoUsuario
      .from('campaigns')
      .select('id, last_turn_seq')
      .eq('id', campaignId)
      .single()
    if (!campanha) throw new RespostaDeErro(404, 'Campanha nao encontrada.')

    const [mundoRes, turnoRes] = await Promise.all([
      ctx.comoUsuario.from('world_state').select('*').eq('campaign_id', campaignId).single(),
      ctx.comoUsuario
        .from('turns')
        .select('id, seq, narrative')
        .eq('campaign_id', campaignId)
        .order('seq', { ascending: false })
        .limit(1),
    ])

    const mundo = mundoRes.data
    if (!mundo) throw new RespostaDeErro(409, 'Esta campanha ainda nao tem estado de mundo.')
    const ultimoTurno = turnoRes.data?.[0]

    const npcs = Array.isArray(mundo.present_npcs) ? mundo.present_npcs : []

    // A narrativa entra truncada: o modelo de imagem nao precisa do texto todo,
    // e prompt longo aqui nao melhora o resultado.
    const trecho = ultimoTurno?.narrative
      ? ultimoTurno.narrative.replace(/[*_#`]/g, '').slice(0, 500)
      : ''

    const prompt = [
      mundo.current_location ? `Cena: ${mundo.current_location}.` : '',
      mundo.location_description ? `${mundo.location_description}` : '',
      npcs.length ? `Presentes: ${npcs.join(', ')}.` : '',
      mundo.weather ? `Clima: ${mundo.weather}.` : '',
      trecho ? `Momento: ${trecho}` : '',
      estilo,
    ]
      .filter(Boolean)
      .join(' ')

    const { restante, devolver } = await reservarQuota(ctx, 'image')

    try {
      const imagem = await generateImage({
        model: Deno.env.get('GEMINI_MODEL_IMAGE') ?? MODELO_PADRAO,
        prompt,
        aspectRatio: Deno.env.get('GEMINI_IMAGE_ASPECT') ?? '16:9',
        imageSize: Deno.env.get('GEMINI_IMAGE_SIZE') ?? '1K',
        mimeType: 'image/jpeg',
      })

      // O primeiro segmento do caminho e o id da campanha: e assim que a policy
      // de storage confere a posse.
      const caminho = `${campaignId}/${campanha.last_turn_seq}-${crypto.randomUUID()}.jpg`

      const { error: upErro } = await ctx.comoServico.storage
        .from('scenes')
        .upload(caminho, imagem.bytes, { contentType: imagem.mimeType, upsert: false })

      if (upErro) throw new Error(`Falha ao salvar a imagem: ${upErro.message}`)

      if (ultimoTurno) {
        await ctx.comoServico
          .from('turns')
          .update({ scene_image_url: caminho })
          .eq('id', ultimoTurno.id)
      }

      const { data: assinada } = await ctx.comoServico.storage
        .from('scenes')
        .createSignedUrl(caminho, VALIDADE_URL_SEGUNDOS)

      // p_images fica em 0 de proposito: consume_image_quota ja incrementou o
      // contador ao reservar. Passar 1 aqui contaria a mesma imagem duas vezes
      // e cortaria a quota do jogador pela metade.
      await ctx.comoServico.rpc('record_turn_tokens', {
        p_user: ctx.userId,
        p_tokens_input: 0,
        p_tokens_output: 0,
        p_images: 0,
      })

      return json(req, {
        storage_path: caminho,
        signed_url: assinada?.signedUrl ?? null,
        prompt,
        turn_seq: ultimoTurno?.seq ?? null,
        quota: { images_remaining: restante },
      })
    } catch (e) {
      await devolver()
      throw e
    }
  } catch (e) {
    if (e instanceof RespostaDeErro) return erro(req, e.message, e.status, e.extra)
    if (e instanceof GeminiError) {
      console.error('gemini-image', e.status, e.message, e.detail)
      return erro(req, 'Falha ao gerar a imagem da cena.', 502)
    }
    console.error('generate-scene', e)
    return erro(req, 'Erro inesperado ao gerar a cena.', 500)
  }
})
