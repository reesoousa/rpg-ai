-- Suporte para as Edge Functions.

-- ---------------------------------------------------------------------------
-- rules_digest: a otimizacao de custo mais importante do projeto.
--
-- O plano original mandava o livro de regras inteiro para o modelo a cada
-- consulta, congelado em Context Caching explicito. Os numeros nao fecham:
-- um livro de ~200k tokens em cache explicito custa US$ 1,00 por 1M tokens
-- POR HORA de armazenamento, ou seja ~US$ 0,20/hora, ~US$ 144/mes se ficar
-- ligado. Para uso pessoal isso e proibitivo.
--
-- A alternativa: extrair UMA VEZ um resumo operacional das regras — o que o
-- mestre precisa saber para narrar e resolver acoes — e enviar so isso, na
-- casa dos poucos milhares de tokens. Cabe no prefixo estavel do prompt e
-- pega o cache IMPLICITO, que e automatico e nao cobra armazenamento.
--
-- O cache explicito continua possivel para uma sessao especifica (TTL curto,
-- aquecido ao abrir a mesa), mas deixa de ser o padrao.
-- ---------------------------------------------------------------------------
alter table public.systems
  add column rules_digest text;

comment on column public.systems.rules_digest is
  'Resumo operacional das regras, gerado uma vez a partir do PDF. Vai no prompt de cada turno no lugar do livro inteiro.';

alter table public.adventures
  add column plot_digest text;

comment on column public.adventures.plot_digest is
  'Resumo operacional da aventura para o prompt. Diferente de source_text, que e o texto integral e nunca vai ao navegador.';

-- Estas duas colunas alimentam o prompt e nao precisam trafegar para o cliente.
-- Como o grant de select em systems e por tabela, e preciso trocar por colunas.
revoke all on public.systems from anon, authenticated;
grant select (
  id, slug, name, tagline, description, publisher, cover_url,
  is_published, created_at, updated_at
) on public.systems to anon, authenticated;
grant insert, update, delete on public.systems to authenticated;

grant select (
  id, system_id, slug, title, synopsis, cover_url,
  gemini_cache_name, gemini_cache_expires_at,
  is_published, created_at, updated_at
) on public.adventures to anon, authenticated;

-- ---------------------------------------------------------------------------
-- refund_turn_quota: devolve o credito quando a chamada ao modelo falha.
--
-- A quota e reservada antes de chamar o Gemini, para proteger o custo. Sem
-- devolucao, uma indisponibilidade do provedor consumiria o dia do jogador.
-- Nao desce abaixo de zero.
-- ---------------------------------------------------------------------------
create function public.refund_turn_quota(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.usage_daily
  set turns_count = greatest(turns_count - 1, 0)
  where user_id = p_user
    and day = current_date;
$$;

revoke execute on function public.refund_turn_quota(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Privilegios do service_role — as Edge Functions dependem disto.
--
-- Duas armadilhas descobertas testando de verdade, ambas silenciosas:
--
-- 1. Os `revoke all ... from anon, authenticated` das migrations anteriores
--    deixaram o service_role apenas com REFERENCES/TRIGGER/TRUNCATE. Sem os
--    grants abaixo, a function nao consegue gravar turno nem ler estado, e o
--    erro so aparece em runtime como 403 do PostgREST.
--
-- 2. `revoke execute on function ... from public` tira o privilegio do
--    service_role tambem, porque ele o tinha via PUBLIC e nao por grant
--    proprio. As tres funcoes de quota precisam de grant explicito.
--
-- O service_role e a chave de backend: ela nunca chega ao navegador, vive como
-- secret da Edge Function. Dar DML completo a ela e o desenho normal do
-- Supabase — o limite de quem pode o que continua sendo RLS para anon e
-- authenticated.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

grant execute on function public.consume_turn_quota(uuid) to service_role;
grant execute on function public.record_turn_tokens(uuid, integer, integer, integer) to service_role;
grant execute on function public.refund_turn_quota(uuid) to service_role;
