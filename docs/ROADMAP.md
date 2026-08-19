# Estado do projeto e o que falta

> Atualizado em 19/08/2026, ao fim do primeiro deploy em producao.
> Este arquivo e a fonte da verdade sobre o que existe e o que nao existe.

## No ar

- **App:** https://reesoousa.github.io/rpg-ai/
- **Supabase:** projeto `oufpzhderlquvbfjzzfj` (regiao `us-west-2`)
- 8 migrations aplicadas, 6 Edge Functions publicadas, `GEMINI_API_KEY` nos secrets

## Pronto e verificado

| Area | Estado |
|------|--------|
| Design system | Tokens dark/light com contraste medido, Archivo + IBM Plex |
| Banco | 12 tabelas, RLS em todas, quota de turno e de imagem |
| Edge Functions | `play-turn`, `start-campaign`, `character-wizard`, `ingest-rulebook`, `extract-adventure`, `generate-scene` |
| UI do jogador | Login por magic link, dashboard, wizard de personagem, engine, ficha em drawer, cena |
| Painel do mestre | Sistemas, aventuras e livros, com upload de capa |
| Vitrine | Lista sistemas e aventuras publicados |
| CI/CD | GitHub Actions publica no Pages a cada merge em `main` |
| Testes | 29 do cliente Gemini (sem Docker), 20 de RLS, 33 do turno, 73 da base |

## A causa das falhas de IA — MEDIDA

`pnpm probe:gemini` rodou contra a API real. O resultado:

| O que se achava | O que a API respondeu |
|-----------------|-----------------------|
| modelos podiam nao existir | os tres existem e a chave alcanca todos |
| `generationConfig.thinkingLevel` | **400** `Unknown name "thinkingLevel"` — o campo nao existe |
| — | `thinkingConfig.thinkingBudget` -> **200 STOP**, resposta completa |
| — | `gemini-3.7-flash` -> **503 em metade das chamadas**, "high demand" |

**A causa era o 503.** O cliente tratava qualquer status nao-400 como
definitivo e lancava na hora, então um pico de demanda de segundos virava turno
perdido. O wizard era a unica coisa que funcionava porque e a unica function que
usa `gemini-3.1-flash-lite`, modelo pouco disputado — nao tinha nada a ver com
o codigo dela.

E o `thinkingLevel` invalido piorava: toda chamada com thinking queimava uma
requisicao num 400 garantido antes de tentar a forma boa, multiplicando as
chances de esbarrar num 503 nas tentativas seguintes.

Corrigido:

- `thinkingConfig.thinkingBudget` e a primeira tentativa (niveis do CLAUDE.md
  viram orcamento: `low` = 512, `medium` = 2048)
- **retry com espera crescente em 429 e 5xx**, tres tentativas. 400 e 403 nao
  sao repetidos: payload errado e chave errada nao melhoram esperando
- 503 esgotado vira `GeminiSobrecargaError` -> HTTP 503 com "esta
  sobrecarregado, costuma passar em alguns segundos", em vez de "falha ao gerar"
- teto de saida 2048 -> 4096: thinking sai da MESMA cota do texto
- `200` com texto vazio tenta a variante seguinte, e termina em
  `GeminiSemSaidaError` dizendo que o teto estourou
- toda falha do provedor chega ao app com o codigo de razao (`NOT_FOUND`,
  `RESOURCE_EXHAUSTED`, `PERMISSION_DENIED`, ...) — `erroDoModelo` em
  `_shared/http.ts`

Coberto por `pnpm test:gemini`: 29 verificacoes contra um servidor local
programavel, sem Docker e sem chave. Era o teste que faltava — o stub sempre
responde 200, então nenhum teste via o cliente receber 503.

### O que ainda nao foi verificado

1. **`generate-scene`.** O caminho de imagem (`POST /v1beta/interactions`) segue
   sem nenhuma chamada real. `pnpm probe:gemini --image` testa os dois formatos
   possiveis, mas custa mais que os testes de texto
2. **A qualidade da narrativa.** O `SYSTEM_INSTRUCTION` nunca foi lido por um
   modelo de verdade
3. **Se `gemini-3.7-flash` serve como padrao.** O retry cobre o 503 comum, mas
   metade das chamadas falhando na primeira tentativa custa latencia. A secao 5
   da sonda mede a taxa por modelo; trocar e o secret `GEMINI_MODEL_TURN`, sem
   commit


Todo o teste automatizado usa um **stub** que valida o payload mas nao chama a
API. O que isso significa:

1. **`generate-scene` e o maior risco.** A documentacao de geracao de imagem
   descreve a Interactions API (`POST /v1beta/interactions`), diferente do
   `generateContent` usado no resto. O codigo tolera os dois formatos de
   resposta conhecidos, mas a primeira chamada real pode exigir ajuste.
2. **O campo de thinking nao esta confirmado** para `generateContent`. O cliente
   tenta `thinkingLevel`, depois `thinkingConfig`, depois segue sem — funciona,
   mas nao se sabe qual variante a API aceita.
3. **A qualidade da narrativa** e desconhecida. O stub devolve texto fixo; o
   `SYSTEM_INSTRUCTION` em `_shared/context.ts` nunca foi testado de verdade.

## Lacunas de integracao — FECHADAS

As quatro lacunas de "dados extraidos que ninguem usa" foram ligadas, e cada
uma tem teste que falha se a ligacao se romper:

1. **`adventure_entities` entra no prompt** (`aventuraMd` em
   `_shared/context.ts`, teto de 60 entidades). Coberto por `test-play-turn`
   (`prompt leva as entidades da aventura`) e `test-base`.
2. **`plot_digest` entra no prompt**, na secao `## a trama`.
3. **`suggested_actions` aparece na `ActionBar`** como chips que enviam o turno
   direto.
4. **Aventura entra na criacao de campanha**: o stepper tem um passo dedicado, e
   `start-campaign` usa uma instrucao de abertura diferente quando ha aventura,
   para a primeira cena aterrissar dentro dela em vez de comecar generica.

Duas coisas alem disso:

- **Extracao de aventura a partir de PDF.** `extract-adventure` aceita
  `source_pdf_path` (arquivo no bucket `rulebooks`, apagado depois de lido).
  Antes so aceitava texto colado, o que na pratica inviabilizava usar um modulo
  de aventura de verdade.
- **Painel do mestre reorganizado**: uma tela por sistema, com identidade,
  livro de regras e aventuras dentro. As abas "Aventuras" e "Livros" nao
  existem mais. Um sistema publicado sem livro lido agora avisa na tela.

## Falta construir

### Alto valor
- **Deploy das Edge Functions.** As correcoes de retry e thinking so valem em
  producao depois de `supabase functions deploy` — o Actions publica o Pages,
  nao as functions
- **Decidir o modelo do turno com o dado da secao 5 da sonda**
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

### Baixo
- Testes automatizados do frontend (hoje a verificacao e manual no navegador)
- Cache explicito do Gemini por sessao, com TTL curto, como opcao
- Regiao do Supabase e `us-west-2`: ~150ms extra do Brasil. Mudar exige recriar
  o projeto

## Pendencias fora do codigo

- [ ] **Adicionar `https://reesoousa.github.io/rpg-ai/entrar`** em Authentication
      -> URL Configuration. Sem isso o magic link nao volta para o app
- [ ] **Rotacionar a chave do Google.** A original circulou em texto plano num
      chat. Revogar no AI Studio, gerar outra, configurar por
      `supabase secrets set` sem passar por terceiros
- [ ] **Teto de orcamento** no projeto Google (`projects/235032798011`). E o que
      transforma um vazamento catastrofico em um vazamento chato
- [x] ~~**Docker Desktop quebrado**~~ — voltou a funcionar. Os tres conjuntos
      rodam: 20 de RLS, 33 do turno, 73 da base. Atencao: `supabase start`
      restaurou o banco de um backup DEFASADO, sem a migration de capas; se
      aparecer `column systems.cover_path does not exist`, rode
      `pnpm supabase db reset`

## Decisoes que nao devem ser revisitadas sem motivo

- **Sem shadcn/ui.** Os componentes gerados nascem com `border`, o que viola as
  regras 1 e 2 do design system
- **Context caching explicito nao e o padrao.** Cobra armazenamento por hora;
  um livro de 200k tokens sairia por ~US$ 144/mes. O substituto e o
  `rules_digest`
- **PDF apagado apos a ingestao**, imagem de cena no IndexedDB. Capa, sim, fica
  no Supabase — e pequena, publica e poucas
- **`turns` e somente-leitura para o cliente.** Narrativa forjada corromperia o
  contexto dos turnos seguintes
