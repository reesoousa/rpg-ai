// Wizard de criacao de personagem: um chat que ajuda a preencher a ficha.
//
// Sem estado no servidor. O cliente devolve a conversa inteira a cada chamada,
// porque o wizard e curto (poucas trocas) e guardar rascunho no banco criaria
// registro orfao para cada tentativa abandonada.
//
// NOTA: o contrato desta function e o unico que provavelmente vai mudar quando
// a UI existir — o formato do chat depende do fluxo de tela.

import { erro, erroDoModelo, json, preflight } from '../_shared/http.ts'
import { generateStructured } from '../_shared/gemini.ts'
import { WIZARD_SCHEMA, type WizardResponse } from '../_shared/schemas.ts'
import {
  RespostaDeErro,
  autenticar,
  exigirTexto,
  lerJson,
  reservarQuota,
} from '../_shared/request.ts'

// Tarefa de preenchimento, nao de narrativa: modelo barato resolve.
const MODELO_PADRAO = 'gemini-3.1-flash-lite'

/** Teto de trocas. Wizard que nao fecha em 12 mensagens esta em loop. */
const MAX_MENSAGENS = 12

const INSTRUCAO = `Voce conduz a criacao de personagem de um RPG solo, em portugues do Brasil.

- Uma pergunta por vez. No maximo 60 palavras por mensagem.
- Ofereca duas ou tres opcoes concretas quando isso ajudar a decidir. O jogador
  pode nao conhecer o sistema.
- Aceite respostas vagas: transforme "quero ser furtivo" em atributos plausiveis
  em vez de pedir numeros.
- Nunca peca ao jogador para escolher valores numericos diretamente. Voce decide
  os numeros a partir do conceito.
- Quando tiver nome, conceito e uma nocao de competencias, marque ready=true e
  devolva a ficha completa. Nao arraste a conversa.
- Se o jogador pedir para terminar logo, feche com o que tem.`

interface Corpo {
  system_id?: string
  messages?: Array<{ role?: string; text?: string }>
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return erro(req, 'Use POST.', 405)

  try {
    const ctx = await autenticar(req)
    const corpo = await lerJson<Corpo>(req)
    const systemId = exigirTexto(corpo.system_id, 'system_id', 64)

    const mensagens = Array.isArray(corpo.messages) ? corpo.messages : []
    if (mensagens.length > MAX_MENSAGENS) {
      throw new RespostaDeErro(
        400,
        `Conversa longa demais (max ${MAX_MENSAGENS} mensagens). Finalize a ficha.`,
      )
    }
    for (const m of mensagens) {
      if (m.role !== 'user' && m.role !== 'model') {
        throw new RespostaDeErro(400, 'Cada mensagem precisa de role user ou model.')
      }
      if (typeof m.text !== 'string' || m.text.length > 1500) {
        throw new RespostaDeErro(400, 'Mensagem invalida ou longa demais.')
      }
    }

    const { data: sistema } = await ctx.comoUsuario
      .from('systems')
      .select('id, name')
      .eq('id', systemId)
      .single()
    if (!sistema)
      throw new RespostaDeErro(404, 'Sistema nao encontrado ou nao publicado.')

    const { data: digests } = await ctx.comoServico
      .from('systems')
      .select('rules_digest')
      .eq('id', systemId)
      .single()

    const { restante, devolver } = await reservarQuota(ctx, 'turn')

    try {
      const contexto = [
        `Sistema: ${sistema.name}`,
        digests?.rules_digest
          ? `\nRegras do sistema (para escolher numeros coerentes):\n${digests.rules_digest}`
          : '',
      ].join('')

      const conteudos = [
        { role: 'user' as const, text: contexto },
        ...mensagens.map((m) => ({
          role: m.role as 'user' | 'model',
          text: m.text as string,
        })),
      ]

      // Primeira chamada: nao ha mensagem do jogador, então pedimos a abertura.
      if (!mensagens.length) {
        conteudos.push({
          role: 'user' as const,
          text: 'Comece a criacao. Faca a primeira pergunta.',
        })
      }

      const resultado = await generateStructured<WizardResponse>({
        model: Deno.env.get('GEMINI_MODEL_WIZARD') ?? MODELO_PADRAO,
        systemInstruction: INSTRUCAO,
        contents: conteudos,
        responseSchema: WIZARD_SCHEMA,
        temperature: 0.8,
        maxOutputTokens: 1024,
      })

      await ctx.comoServico.rpc('record_turn_tokens', {
        p_user: ctx.userId,
        p_tokens_input: resultado.usage.promptTokens,
        p_tokens_output: resultado.usage.outputTokens + resultado.usage.thoughtTokens,
        p_images: 0,
      })

      // O modelo pode marcar ready sem entregar a ficha. Nao repassamos ready
      // sem personagem: a UI ficaria travada esperando dados que nao vieram.
      const pronto = Boolean(resultado.data.ready && resultado.data.character?.name)

      return json(req, {
        reply: resultado.data.reply,
        ready: pronto,
        character: pronto ? resultado.data.character : null,
        quota: { turns_remaining: restante },
      })
    } catch (e) {
      await devolver()
      throw e
    }
  } catch (e) {
    if (e instanceof RespostaDeErro) return erro(req, e.message, e.status, e.extra)
    const doModelo = erroDoModelo(req, e, 'consultar o assistente')
    if (doModelo) return doModelo
    console.error('character-wizard', e)
    return erro(req, 'Erro inesperado no wizard.', 500)
  }
})
