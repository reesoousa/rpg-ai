-- Storage e as quotas que faltavam.

-- ---------------------------------------------------------------------------
-- Buckets
--
-- Os dois sao privados. `rulebooks` guarda material licenciado e so o mestre
-- alcanca; `scenes` guarda imagem gerada da campanha de alguem, que e conteudo
-- daquele jogador. A UI le por URL assinada, gerada com o JWT do proprio
-- usuario — nao ha URL publica permanente.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('rulebooks', 'rulebooks', false, 52428800, array['application/pdf']),
  ('scenes', 'scenes', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Policies de storage.
--
-- O caminho carrega a autorizacao: em `scenes` o primeiro segmento e o id da
-- campanha, então a posse e verificada por owns_campaign().
-- ---------------------------------------------------------------------------
create policy "rulebooks: somente mestre"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'rulebooks' and public.is_master())
  with check (bucket_id = 'rulebooks' and public.is_master());

create policy "scenes: dono da campanha le"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'scenes'
    and public.owns_campaign(((storage.foldername(name))[1])::uuid)
  );

-- Quem escreve em `scenes` e a Edge Function (service_role), depois de gerar a
-- imagem. O cliente nao sobe imagem arbitraria para a campanha.

-- ---------------------------------------------------------------------------
-- Quota de imagem.
--
-- Imagem custa por unidade e nao por token, então precisa de teto proprio: sem
-- isto, o botao "Gerar Cena" e um ralo de dinheiro independente do limite de
-- turnos.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column daily_image_limit integer not null default 8
    check (daily_image_limit >= 0);

comment on column public.profiles.daily_image_limit is
  'Teto de imagens por dia. Imagem e cobrada por unidade, não por token.';

create function public.consume_image_quota(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
begin
  select p.daily_image_limit into v_limit
  from public.profiles p
  where p.id = p_user;

  if v_limit is null then
    raise exception 'Usuario sem profile: %', p_user using errcode = '42501';
  end if;

  -- Mesmo padrao de consume_turn_quota: incrementa primeiro para o UPDATE
  -- travar a linha, confere depois. A excecao desfaz o incremento.
  insert into public.usage_daily as u (user_id, day, images_count)
  values (p_user, current_date, 1)
  on conflict (user_id, day) do update
    set images_count = u.images_count + 1
  returning u.images_count into v_count;

  if v_count > v_limit then
    raise exception 'Limite diario de % imagens atingido.', v_limit
      using errcode = 'P0001';
  end if;

  return v_limit - v_count;
end;
$$;

create function public.refund_image_quota(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.usage_daily
  set images_count = greatest(images_count - 1, 0)
  where user_id = p_user
    and day = current_date;
$$;

revoke execute on function public.consume_image_quota(uuid) from public, anon, authenticated;
revoke execute on function public.refund_image_quota(uuid) from public, anon, authenticated;
grant execute on function public.consume_image_quota(uuid) to service_role;
grant execute on function public.refund_image_quota(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- my_quota_today ganha as imagens.
--
-- Precisa de drop antes: `create or replace` nao consegue mudar o tipo de
-- retorno de uma funcao que devolve table, e estamos acrescentando colunas.
-- ---------------------------------------------------------------------------
drop function if exists public.my_quota_today();

create function public.my_quota_today()
returns table (
  turns_used integer,
  turns_limit integer,
  turns_remaining integer,
  images_used integer,
  images_limit integer,
  images_remaining integer
)
language sql
security invoker
set search_path = ''
stable
as $$
  select
    coalesce(u.turns_count, 0) as turns_used,
    p.daily_turn_limit as turns_limit,
    greatest(p.daily_turn_limit - coalesce(u.turns_count, 0), 0) as turns_remaining,
    coalesce(u.images_count, 0) as images_used,
    p.daily_image_limit as images_limit,
    greatest(p.daily_image_limit - coalesce(u.images_count, 0), 0) as images_remaining
  from public.profiles p
  left join public.usage_daily u
    on u.user_id = p.id and u.day = current_date
  where p.id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Registro de ingestao de livro.
--
-- Ingerir um PDF e a operacao mais cara do sistema: cada pagina vale 258
-- tokens de entrada, então um livro de 400 paginas custa ~103k tokens numa
-- unica chamada. Guardar o custo real permite auditar depois.
-- ---------------------------------------------------------------------------
alter table public.rulebooks
  add column ingest_tokens_input integer,
  add column ingest_tokens_output integer,
  add column ingested_at timestamptz,
  add column digest text;

comment on column public.rulebooks.digest is
  'Resumo operacional extraido deste livro. Copiado para systems.rules_digest ao publicar.';

-- Colunas de digest e custo nao precisam ir ao navegador do jogador comum;
-- rulebooks ja e restrito ao mestre, então o grant de tabela basta.
grant select, insert, update, delete on public.rulebooks to authenticated;
