# Estado do projeto e o que falta

> Atualizado em 19/08/2026, depois do PR #8 e da primeira sonda contra a API
> real do Gemini. Este arquivo e a fonte da verdade sobre o que existe e o que
> nao existe.

## Antes de qualquer coisa: frontend e Edge Functions nao sobem juntos

O GitHub Actions publica **so o Pages**. As Edge Functions saem por
`supabase functions deploy`, na mao. Ou seja, mergear em `main` coloca a UI nova
no ar com o backend antigo — e agora isso importa, porque o PR #8 mudou os dois
lados.

Estado real neste momento:

| O que | Onde esta |
|-------|-----------|
| Integracao da aventura, stepper, painel por sistema | `main` (PR #8 mergeado) |
| Frontend disso | **no ar** — o Actions publicou no merge |
| Edge Functions disso | **nao publicado** ate rodar `supabase functions deploy` |
| Retry no 503 e campo de thinking correto | branch `feat/integra-ia-e-painel`, **nao mergeado** |

Duas consequencias praticas enquanto as functions nao subirem:

1. **"Ler PDF da aventura" vai falhar com 409.** O botao manda
   `source_pdf_path`, e a versao publicada de `extract-adventure` nao conhece
   esse campo — ela cai no caminho de texto e responde "esta aventura nao tem
   texto de origem".
2. **A aventura continua fora do prompt.** O stepper ja deixa escolher, e
   `start-campaign` publicado ja aceita `adventure_id`, mas quem le
   `plot_digest` e `adventure_entities` e o codigo novo.

```bash
supabase functions deploy
```

## No ar

- **App:** https://reesoousa.github.io/rpg-ai/
- **Supabase:** projeto `oufpzhderlquvbfjzzfj` (regiao `us-west-2`)
- 8 migrations aplicadas, 6 Edge Functions publicadas, `GEMINI_API_KEY` nos
  secrets
- O PR #8 nao trouxe migration nenhuma: o banco em producao esta em dia

## Pronto e verificado

| Area | Estado |
|------|--------|
| Design system | Tokens dark/light com contraste medido, Archivo + IBM Plex |
| Banco | 11 tabelas, RLS em todas, quota de turno e de imagem |
| Edge Functions | `play-turn`, `start-campaign`, `character-wizard`, `ingest-rulebook`, `extract-adventure` (texto ou PDF), `generate-scene` |
| Cliente do Gemini | Retry em 429/5xx, thinking na forma que a API aceita, erro do provedor visivel no app |
| UI do jogador | Login por magic link, dashboard, criacao de campanha em stepper de tela cheia, engine com acoes sugeridas, ficha em drawer, cena |
| Painel do mestre | Uma tela por sistema: identidade, livro de regras e aventuras dentro |
| Vitrine | Lista sistemas e aventuras publicados |
| CI/CD | GitHub Actions publica no Pages a cada merge em `main` (functions, nao) |
| Testes | 155 no total: 29 do cliente Gemini (sem Docker), 20 de RLS, 33 do turno, 73 da base |

## A causa das falhas de IA — medida

`pnpm probe:gemini` rodou contra a API real. O resultado:

| O que se achava | O que a API respondeu |
|-----------------|-----------------------|
| os modelos podiam nao existir | os tres existem e a chave alcanca todos |
| `generationConfig.thinkingLevel` | **400** `Unknown name "thinkingLevel"` — o campo nao existe |
| — | `thinkingConfig.thinkingBudget` -> **200 STOP**, resposta completa |
| — | `gemini-3.7-flash` -> **503 em metade das chamadas**, "high demand" |

**A causa era o 503.** O cliente tratava qualquer status nao-400 como
definitivo e lancava na hora, então um pico de demanda de segundos virava turno
perdido. O wizard era a unica coisa que funcionava porque e a unica function que
usa `gemini-3.1-flash-lite`, modelo pouco disputado — nao tinha nada a ver com o
codigo dela.

E o `thinkingLevel` invalido piorava: toda chamada com thinking queimava uma
requisicao num 400 garantido antes de tentar a forma boa, multiplicando as
chances de esbarrar num 503 nas tentativas seguintes.

Corrigido (branch `feat/integra-ia-e-painel`, ainda nao em `main`):

- `thinkingConfig.thinkingBudget` e a primeira tentativa. Os niveis do
  CLAUDE.md viram orcamento de tokens (`low` = 512, `medium` = 2048): mesmo
  controle, na unidade que o `generateContent` entende
- **retry com espera crescente em 429 e 5xx**, tres tentativas com jitter. 400 e
  403 nao sao repetidos — payload errado e chave errada nao melhoram esperando
- 503 esgotado vira `GeminiSobrecargaError` -> HTTP 503 com "esta sobrecarregado,
  costuma passar em alguns segundos", em vez de "falha ao gerar"
- `generateImage` entrou no mesmo retry: um 503 ali consumia quota de imagem do
  jogador por um pico de segundos
- teto de saida 2048 -> 4096, porque thinking sai da MESMA cota do texto
- `200` com texto vazio tenta a variante seguinte e termina em
  `GeminiSemSaidaError`, que diz que o teto estourou em vez de "conteudo vazio"
- toda falha do provedor chega ao app com o codigo de razao (`NOT_FOUND`,
  `RESOURCE_EXHAUSTED`, `PERMISSION_DENIED`, ...) — `erroDoModelo` em
  `_shared/http.ts`

Coberto por `pnpm test:gemini`: 29 verificacoes contra um servidor HTTP local
programavel, em Node, **sem Docker e sem chave**, em segundos. Era o teste que
faltava. O stub sempre responde 200, então nada nunca exercitou o cliente
recebendo 503 — foi por isso que a falha chegou em producao com o resto dos
testes verde.

## Lacunas de integracao — fechadas

As quatro lacunas de "dados extraidos que ninguem usa" foram ligadas, e cada uma
tem teste que falha se a ligacao se romper:

1. **`adventure_entities` entra no prompt** — `aventuraMd` em
   `_shared/context.ts`, teto de 60 entidades. Coberto em `test-play-turn`
   (`prompt leva as entidades da aventura`) e em `test-base`
2. **`plot_digest` entra no prompt**, na secao `## a trama`
3. **`suggested_actions` aparece na `ActionBar`** como chips que enviam o turno
   direto
4. **Aventura entra na criacao de campanha** — o stepper tem um passo dedicado, e
   `start-campaign` usa instrucao de abertura diferente quando ha aventura, para
   a primeira cena aterrissar dentro dela em vez de comecar generica

Os testes novos afirmam sobre o **prompt realmente enviado**, lendo
`stub-last-request.json`. E a licao do episodio: a lacuna sobreviveu porque a
resposta vinha `200` e nada olhava o que tinha ido.

Duas coisas alem disso:

- **Extracao de aventura a partir de PDF.** `extract-adventure` aceita
  `source_pdf_path` (arquivo no bucket `rulebooks`, apagado depois de lido) e
  sugere sinopse sem sobrescrever a escrita a mao. Antes so aceitava texto
  colado, o que na pratica inviabilizava usar um modulo de aventura de verdade
- **Painel do mestre reorganizado**: uma tela por sistema, com identidade, livro
  de regras e aventuras dentro. As abas "Aventuras" e "Livros" nao existem mais.
  Sistema publicado sem livro lido avisa na tela, e a lista mostra o que falta em
  cada um

## O que ainda nao foi verificado

1. **`generate-scene`.** O caminho de imagem (`POST /v1beta/interactions`) segue
   sem nenhuma chamada real — e o unico do projeto assim. `pnpm probe:gemini
   --image` testa os dois formatos possiveis, mas custa mais que os testes de
   texto
2. **A qualidade da narrativa.** O `SYSTEM_INSTRUCTION` de `_shared/context.ts`
   nunca foi lido por um modelo de verdade. O stub devolve texto fixo
3. **Se `gemini-3.7-flash` serve como padrao do turno.** O retry cobre o 503
   comum, mas metade das chamadas falhando na primeira tentativa custa latencia.
   A secao 5 da sonda mede taxa de recusa e latencia por modelo; trocar e o
   secret `GEMINI_MODEL_TURN`, sem commit
4. **`thinkingConfig.thinkingLevel`** continua inconclusivo — a sonda pegou 503
   nele nas duas rodadas. Fica como segunda tentativa do cliente porque a
   Interactions API usa esse nome; se a API convergir, o cliente acompanha sem
   mudanca

## Falta construir

### Alto valor
- **Publicar as Edge Functions** (ver o aviso no topo) e **mergear o fix do
  503** — sem os dois, a correcao da IA nao existe para quem usa o app
- **Decidir o modelo do turno** com o dado da secao 5 da sonda
- **Paginacao do historico.** Hoje carrega os ultimos 40 turnos e para. Falta
  "carregar anterior" (sem virtualizacao, para nao quebrar selecao de texto)
- **Pausar, finalizar e apagar campanha.** O `status` existe no banco e a policy
  de delete tambem; nao ha UI
- **Editar personagem** depois de criado

### Medio
- **Icones do PWA** (192/512 + maskable). O manifest esta com `icons: []` porque
  nao ha arte; sem eles a instalacao no celular fica sem icone decente
- **Streaming da narrativa.** Hoje o texto aparece de uma vez. Exige parse
  incremental do JSON, porque `responseMimeType: application/json` nao entrega
  texto solto
- **Sistema de dados.** O modelo narra resultado sem rolar nada. Nao ha
  aleatoriedade real no jogo
- **Bundle inicial de 167 kB gzip** — `supabase-js` carrega no boot para
  conferir a sessao. Da para separar em chunk de vendor
- **Reingerir livro exige subir o PDF de novo**, porque o arquivo e apagado.
  Vale um aviso melhor na tela do sistema

### Baixo
- Testes automatizados do frontend (hoje a verificacao e manual no navegador)
- Cache explicito do Gemini por sessao, com TTL curto, como opcao
- Regiao do Supabase e `us-west-2`: ~150ms extra do Brasil. Mudar exige recriar
  o projeto

## Pendencias fora do codigo

- [ ] **Adicionar `https://reesoousa.github.io/rpg-ai/entrar`** em Authentication
      -> URL Configuration. Sem isso o magic link nao volta para o app. Isto
      apareceu tambem no ambiente local: o `redirect_to` cai na raiz, que nao e
      a rota de callback, e a sessao nao se estabelece
- [ ] **Rotacionar a chave do Google.** A original circulou em texto plano num
      chat. Revogar no AI Studio, gerar outra, configurar por
      `supabase secrets set` sem passar por terceiros
- [ ] **Teto de orcamento** no projeto Google (`projects/235032798011`). E o que
      transforma um vazamento catastrofico em um vazamento chato
- [x] ~~**Docker Desktop quebrado**~~ — voltou a funcionar. Ressalva: o
      `supabase start` restaurou o banco de um backup DEFASADO, sem a migration
      de capas. Sintoma e `column systems.cover_path does not exist`; a correcao
      e `pnpm supabase db reset`

## Decisoes que nao devem ser revisitadas sem motivo

- **Sem shadcn/ui.** Os componentes gerados nascem com `border`, o que viola as
  regras 1 e 2 do design system
- **Context caching explicito nao e o padrao.** Cobra armazenamento por hora; um
  livro de 200k tokens sairia por ~US$ 144/mes. O substituto e o `rules_digest`
- **PDF apagado apos a ingestao**, imagem de cena no IndexedDB. Capa, sim, fica
  no Supabase — e pequena, publica e poucas
- **`turns` e somente-leitura para o cliente.** Narrativa forjada corromperia o
  contexto dos turnos seguintes
- **Thinking se configura por nivel no codigo do projeto, nao por orcamento.**
  `_shared/gemini.ts` traduz nivel -> tokens. O motivo e que a decisao de custo
  esta escrita em niveis no CLAUDE.md, e o mapa isola o projeto de a API trocar
  a unidade de novo
- **Teste do cliente HTTP nao precisa de Docker.** `test-gemini-client.mjs` sobe
  um servidor em processo e carrega `gemini.ts` com um `Deno.env` de mentira.
  Container so onde ele paga: RLS, policies e o caminho ponta a ponta
