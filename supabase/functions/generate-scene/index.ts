// Botao "Gerar Cena": estado do mundo -> imagem.
//
// A imagem NAO e armazenada no Supabase. Ela volta na resposta, em base64, e o
// app guarda no IndexedDB do navegador. Motivo: o plano free da 1 GB de
// Storage, e cada imagem come 200-400 KB — encheria em poucas centenas de
// cenas, para guardar algo que so aquele jogador olha.
//
// O que fica no banco e o PROMPT, que e texto e ocupa nada. Com ele, o botao
// "regerar" reproduz AQUELA cena em vez de sortear uma nova — sem isso, quem
// perdesse a imagem perderia a cena.
//
// O prompt da imagem e montado no codigo, a partir do estado do mundo e do
// ultimo turno. Nao ha chamada de texto ao modelo antes: seria dobrar o custo
// para escrever uma frase que o proprio estado ja descreve.
//
// Quota propria: imagem e cobrada por unidade, nao por token, entao o limite de
// turnos nao a protege.

import { erro, erroDoModelo, json, preflight } from '../_shared/http.ts'
import { generateImage } from '../_shared/gemini.ts'
import {
  RespostaDeErro,
  autenticar,
  exigirTexto,
  lerJson,
  reservarQuota,
} from '../_shared/request.ts'

const MODELO_PADRAO = 'gemini-3.1-flash-image'

interface Corpo {
  campaign_id?: string
  /** Sobrescreve o estilo padrao, se o jogador quiser outro. */
  style?: string
  /**
   * Regerar a cena de um turno especifico, usando o prompt ja guardado.
   * E o caminho de quem perdeu a imagem — trocou de aparelho, limpou o cache.
   */
  regenerate_turn_seq?: number
}

const ESTILO_PADRAO =
  'ilustracao digital, luz dramatica, composicao cinematografica, sem texto, sem interface'

function bytesParaBase64(bytes: Uint8Array): string {
  let bin = ''
  const BLOCO = 0x8000
  for (let i = 0; i < bytes.length; i += BLOCO) {
    bin += String.fromCharCode(...bytes.subarray(i, i + BLOCO))
  }
  return btoa(bin)
}

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

    let prompt: string
    let turnoAlvo: { id: string; seq: number } | null = null

    if (corpo.regenerate_turn_seq !== undefined) {
      // --- regerar: reutiliza o prompt guardado, para sair a MESMA cena.
      const seq = Number(corpo.regenerate_turn_seq)
      if (!Number.isInteger(seq) || seq < 1) {
        throw new RespostaDeErro(400, 'regenerate_turn_seq deve ser um inteiro positivo.')
      }

      const { data: turno } = await ctx.comoUsuario
        .from('turns')
        .select('id, seq, scene_prompt')
        .eq('campaign_id', campaignId)
        .eq('seq', seq)
        .single()

      if (!turno) throw new RespostaDeErro(404, 'Turno nao encontrado.')
      if (!turno.scene_prompt) {
        throw new RespostaDeErro(
          409,
          'Este turno nunca teve cena gerada. Use o botao normal de gerar cena.',
        )
      }
      prompt = turno.scene_prompt
      turnoAlvo = { id: turno.id, seq: turno.seq }
    } else {
      // --- cena nova: monta a partir do estado atual.
      const [mundoRes, turnoRes] = await Promise.all([
        ctx.comoUsuario
          .from('world_state')
          .select('*')
          .eq('campaign_id', campaignId)
          .single(),
        ctx.comoUsuario
          .from('turns')
          .select('id, seq, narrative')
          .eq('campaign_id', campaignId)
          .order('seq', { ascending: false })
          .limit(1),
      ])

      const mundo = mundoRes.data
      if (!mundo)
        throw new RespostaDeErro(409, 'Esta campanha ainda nao tem estado de mundo.')

      const ultimo = turnoRes.data?.[0]
      if (ultimo) turnoAlvo = { id: ultimo.id, seq: ultimo.seq }

      const npcs = Array.isArray(mundo.present_npcs) ? mundo.present_npcs : []

      // A narrativa entra truncada: o modelo de imagem nao precisa do texto
      // todo, e prompt longo aqui nao melhora o resultado.
      const trecho = ultimo?.narrative
        ? ultimo.narrative.replace(/[*_#`]/g, '').slice(0, 500)
        : ''

      prompt = [
        mundo.current_location ? `Cena: ${mundo.current_location}.` : '',
        mundo.location_description ?? '',
        npcs.length ? `Presentes: ${npcs.join(', ')}.` : '',
        mundo.weather ? `Clima: ${mundo.weather}.` : '',
        trecho ? `Momento: ${trecho}` : '',
        estilo,
      ]
        .filter(Boolean)
        .join(' ')
    }

    const { restante, devolver } = await reservarQuota(ctx, 'image')

    try {
      const imagem = await generateImage({
        model: Deno.env.get('GEMINI_MODEL_IMAGE') ?? MODELO_PADRAO,
        prompt,
        aspectRatio: Deno.env.get('GEMINI_IMAGE_ASPECT') ?? '16:9',
        imageSize: Deno.env.get('GEMINI_IMAGE_SIZE') ?? '1K',
        mimeType: 'image/jpeg',
      })

      // Guarda apenas o prompt e a marca de tempo. A imagem vai para o cliente.
      if (turnoAlvo) {
        await ctx.comoServico
          .from('turns')
          .update({ scene_prompt: prompt, scene_generated_at: new Date().toISOString() })
          .eq('id', turnoAlvo.id)
      }

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
        turn_seq: turnoAlvo?.seq ?? null,
        prompt,
        mime_type: imagem.mimeType,
        // O app guarda isto no IndexedDB. Nao volta em nenhuma leitura futura:
        // se o dispositivo perder, o caminho e regenerate_turn_seq.
        image_base64: bytesParaBase64(imagem.bytes),
        size_bytes: imagem.bytes.length,
        regenerated: corpo.regenerate_turn_seq !== undefined,
        quota: { images_remaining: restante },
      })
    } catch (e) {
      await devolver()
      throw e
    }
  } catch (e) {
    if (e instanceof RespostaDeErro) return erro(req, e.message, e.status, e.extra)
    const doModelo = erroDoModelo(req, e, 'gerar a imagem da cena')
    if (doModelo) return doModelo
    console.error('generate-scene', e)
    return erro(req, 'Erro inesperado ao gerar a cena.', 500)
  }
})
