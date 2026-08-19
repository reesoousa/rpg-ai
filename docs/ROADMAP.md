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
| Testes | 20 de RLS, 28 do turno, 58 da base — todos contra Supabase local |

## Nao verificado com o Gemini real

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

## Lacunas de integracao (dados extraidos que ninguem usa)

Estas sao as mais importantes, porque parecem prontas e nao estao:

1. **`adventure_entities` nao entra no prompt.** A fabrica de campanhas extrai
   locais, NPCs, itens, faccoes e eventos — e `play-turn` nunca le. O mestre
   joga sem saber quem existe na aventura.
2. **`plot_digest` nao entra no prompt.** Mesmo problema: a aventura e resumida
   e o resumo fica parado no banco.
3. **`suggested_actions` e ignorado pela UI.** A function devolve duas a quatro
   acoes plausiveis por turno; a `ActionBar` nao as mostra.
4. **Aventura nao entra na criacao de campanha.** `start-campaign` aceita
   `adventure_id`, mas `NewCampaignPage` so deixa escolher o sistema.

## Falta construir

### Alto valor
- Ligar as quatro lacunas acima
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
- [ ] **Docker Desktop quebrado** na maquina do dono. Nao bloqueia producao, mas
      impede `pnpm db:test-rls`, `pnpm test:e2e` e `pnpm test:base`

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
