# rpg-ai — regras do projeto

## Contexto que muda decisoes

**Este repositorio e PUBLICO.** Ele e publico porque GitHub Pages em repo privado
exige plano Pro, e a decisao foi nao pagar. Logo, a seguranca nao pode depender
de o codigo estar escondido — ela depende dos controles abaixo.

Consequencia pratica: qualquer pessoa le este codigo, o bundle publicado e a
`anon key`. Isso e normal e esperado. O que **nao** pode acontecer e um segredo
real entrar no git ou no bundle.

## Seguranca — regras inviolaveis

1. **Nenhum segredo no frontend.** Se uma chave nao pode ser vista por um
   visitante do site, ela nao pode existir em `src/`, em `.env`, nem em variable
   do Actions. Vive apenas como secret de Edge Function.
2. **A chave do Gemini nunca sai do Supabase.** Nao vai para arquivo, commit,
   log ou variable do CI. Configurada por `supabase secrets set` ou pelo painel.
3. **RLS em toda tabela, sem excecao.** Tabela sem `ENABLE ROW LEVEL SECURITY`
   num projeto publico e banco aberto. A policy vai no mesmo arquivo de migration
   que cria a tabela — nunca "depois".
4. **Autorizacao e sempre no servidor.** Guard de rota no cliente e UX, nao
   seguranca. Quem decide e a policy do Postgres ou a Edge Function.
5. **Toda Edge Function que gasta token verifica**, na ordem: JWT valido → o
   usuario e dono do recurso → o usuario nao passou do limite de uso.
6. **O workflow nunca roda em `pull_request`.** Em repo publico isso permitiria
   um PR de fork extrair as variables. Somente `push` em `main` e
   `workflow_dispatch`.
7. **Segredo vazado nao se apaga, se rotaciona.** Reescrever historico nao
   resolve: assuma que ja foi coletado e gere uma chave nova.

## O que e publico por design (nao e vazamento)

- `VITE_SUPABASE_URL` e a `anon key` — vao no bundle, protegidas por RLS.
- Todo o codigo-fonte do frontend.

## Design

Tokens, tipografia e as regras anti-generico estao em
[`docs/design/DESIGN.md`](docs/design/DESIGN.md). As duas mais violadas por
descuido:

- **Sem contorno hairline** (`border-white/10`, `ring-1`) em card, botao ou input.
  Separacao vem de superficie e sombra. Unica excecao: `:focus-visible`.
- **Sem icone dentro de box tonal** de baixa opacidade. Icone solto.

Nao usamos shadcn/ui: os componentes gerados nascem com `border`, o que viola a
regra acima. Primitivos escritos a mao em `src/components/ui/`; Radix entra
direto quando precisar de comportamento acessivel (Drawer, Dialog).

## Comandos

```bash
pnpm dev          # servidor de desenvolvimento
pnpm build        # build + 404.html para o fallback de SPA do Pages
pnpm typecheck    # tsc
pnpm lint         # oxlint
```

Validar as migrations e as policies (precisa do Docker rodando):

```bash
pnpm db:validate     # SQL compila? RLS ligada em toda tabela?
pnpm db:test-rls     # as policies barram o que deveriam barrar?
```

Rodar os dois SEMPRE que mexer em migration. `db:test-rls` ja pegou uma falha
real: `grant update` na tabela seguido de `revoke update (coluna)` nao protege
a coluna no Postgres.

Validar contraste apos mexer em qualquer token de cor:

```bash
node docs/design/contrast-check.mjs
```

Testar as Edge Functions ponta a ponta, sem gastar token de IA. Em tres
terminais:

```bash
pnpm supabase start
```

```bash
pnpm stub:gemini
```

```bash
pnpm fn:serve
```

Depois, com as credenciais locais no ambiente:

```bash
pnpm test:e2e     # play-turn
```

```bash
pnpm test:base    # start-campaign, wizard, ingest, extract, scene
```

O stub responde no formato do Gemini **e valida o payload** que a function
enviou: safety settings, `responseSchema` e a ordem das partes do prompt. Os
testes tambem afirmam sobre o prompt REALMENTE ENVIADO, lendo
`stub-last-request.json` — foi assim que a aventura passou meses sendo extraida
para o banco sem nunca chegar ao modelo: a resposta vinha 200 e ninguem olhava
o que tinha ido.

Se o banco local vier de um backup defasado (sintoma: `column
systems.cover_path does not exist`), reaplique as migrations:

```bash
pnpm supabase db reset
```

Testar o cliente do Gemini — retry, recuo de thinking, resposta vazia — sem
Docker e sem chave, contra um servidor local programavel. Roda em segundos:

```bash
pnpm test:gemini
```

Este e o teste que faltava. O stub sempre responde 200, então nenhum teste
exercitava o cliente recebendo 503, e foi exatamente isso que derrubou a IA em
producao.

O stub nao chama a API. Para saber o que a API REAL aceita e qual modelo de fato
atende:

```bash
pnpm probe:gemini
```

A chave sai do ambiente (`GEMINI_API_KEY`) e a saida e filtrada: nenhuma linha
dela contem a chave. Nao existe caminho em que ela entre em arquivo ou commit.

## IA — decisoes de custo

Medido na tabela de precos, nao estimado:

| Uso | Modelo | Por que |
|-----|--------|---------|
| Turno de jogo | `gemini-3.7-flash`, thinking `low` | E a experiencia do produto. Thinking baixo porque narrar nao exige raciocinio profundo, e thinking e cobrado como output |
| Wizard e extracao | `gemini-3.1-flash-lite` | Tarefa de preenchimento e extracao, sem exigencia narrativa |

**Context caching explicito nao e o padrao, ao contrario do plano inicial.** Ele
cobra armazenamento por hora: um livro de ~200k tokens custa ~US$ 0,20/hora,
~US$ 144/mes se ficar ligado. Para uso pessoal e proibitivo.

No lugar dele:

1. `systems.rules_digest` e `adventures.plot_digest` — resumo operacional
   extraido uma vez, na casa dos poucos milhares de tokens.
2. Prompt ordenado do estavel ao volatil, para o cache **implicito** (automatico
   em Gemini 2.5+, sem custo de armazenamento) pegar o prefixo.
3. Janela de historico fixa em 6 turnos.

Cache explicito continua util para uma sessao especifica com TTL curto, mas
como excecao deliberada.

**O campo de thinking do `generateContent` e
`generationConfig.thinkingConfig.thinkingBudget`** — medido, nao deduzido.
`thinkingLevel` no topo do `generationConfig` devolve
`400 Unknown name "thinkingLevel"`. Os niveis do quadro acima viram orcamento de
tokens em `_shared/gemini.ts` (`low` = 512, `medium` = 2048), porque a cobranca
de thinking sai da mesma cota do output e o teto e o mesmo controle na unidade
que a API entende.

**`gemini-3.7-flash` recusa atender com frequencia.** A sonda mediu 503 "This
model is currently experiencing high demand" em metade das chamadas. O cliente
repete em 429 e 5xx, tres tentativas com espera crescente; 403 e 400 nao sao
repetidos, porque chave errada e payload errado nao melhoram esperando. Se a
recusa persistir, trocar o modelo do turno nao exige commit: e o secret
`GEMINI_MODEL_TURN` da Edge Function. Rode `pnpm probe:gemini` para ver a taxa
por modelo antes de decidir.

**Safety settings** ficam em `OFF` nas cinco categorias configuraveis. Duas
ressalvas: o provedor mantem barreiras que nao se desligam por parametro (o
codigo trata `finishReason` de bloqueio com mensagem clara), e a documentacao
avisa que configuracao menos restritiva pode passar por revisao.

## Git

- `main` e protegida: trabalho vai em `feat/*` com PR.
- Conventional Commits, mensagens em pt-BR.
- Sem acentos nas mensagens de commit (evita problema de encoding no Windows).
