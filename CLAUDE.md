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

## Git

- `main` e protegida: trabalho vai em `feat/*` com PR.
- Conventional Commits, mensagens em pt-BR.
- Sem acentos nas mensagens de commit (evita problema de encoding no Windows).
