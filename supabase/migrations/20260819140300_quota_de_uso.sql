-- Controle de custo de IA.
--
-- Motivo: uma chave de API perfeitamente guardada nao impede que um usuario
-- logado gaste os creditos do dono apertando "Continuar" mil vezes. Sem teto
-- por usuario, o app publico e uma credencial vazada com passos extras.

-- Limite diario por usuario. Fica em profiles para permitir excecao individual;
-- o usuario nao consegue alterar porque o grant de update dele cobre apenas
-- display_name (ver 20260819140000_identidade_e_acesso.sql).
alter table public.profiles
  add column daily_turn_limit integer not null default 40
    check (daily_turn_limit >= 0);

comment on column public.profiles.daily_turn_limit is
  'Teto de turnos por dia. Verificado na Edge Function ANTES de chamar o modelo.';

-- ---------------------------------------------------------------------------
-- usage_daily: consumo por usuario por dia.
-- ---------------------------------------------------------------------------
create table public.usage_daily (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null default current_date,
  turns_count integer not null default 0,
  tokens_input bigint not null default 0,
  tokens_output bigint not null default 0,
  images_count integer not null default 0,
  primary key (user_id, day)
);

alter table public.usage_daily enable row level security;

create policy "usage_daily: dono le o proprio consumo"
  on public.usage_daily for select
  to authenticated
  using (user_id = auth.uid());

-- Sem policy de escrita: quem grava e a Edge Function via service_role.
-- Se o cliente pudesse escrever, zeraria o proprio contador.

revoke all on public.usage_daily from anon, authenticated;
grant select on public.usage_daily to authenticated;

-- ---------------------------------------------------------------------------
-- consume_turn_quota: reserva um turno ou recusa.
--
-- Incrementa primeiro e confere depois, de proposito: o UPDATE trava a linha,
-- então duas chamadas simultaneas nao conseguem passar as duas pelo limite.
-- Conferir antes de incrementar abriria essa janela.
--
-- Em caso de estouro, lanca excecao: isso desfaz o incremento junto com a
-- transacao, sem precisar de compensacao manual.
-- ---------------------------------------------------------------------------
create function public.consume_turn_quota(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
begin
  select p.daily_turn_limit into v_limit
  from public.profiles p
  where p.id = p_user;

  if v_limit is null then
    raise exception 'Usuario sem profile: %', p_user using errcode = '42501';
  end if;

  insert into public.usage_daily as u (user_id, day, turns_count)
  values (p_user, current_date, 1)
  on conflict (user_id, day) do update
    set turns_count = u.turns_count + 1
  returning u.turns_count into v_count;

  if v_count > v_limit then
    raise exception 'Limite diario de % turnos atingido.', v_limit
      using errcode = 'P0001';
  end if;

  -- quantos restam depois deste
  return v_limit - v_count;
end;
$$;

comment on function public.consume_turn_quota is
  'Reserva um turno para o usuario. Lanca excecao se estourar o limite diario.';

-- ---------------------------------------------------------------------------
-- record_turn_tokens: contabiliza o custo real depois da resposta do modelo.
-- ---------------------------------------------------------------------------
create function public.record_turn_tokens(
  p_user uuid,
  p_tokens_input integer,
  p_tokens_output integer,
  p_images integer default 0
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.usage_daily as u (
    user_id, day, tokens_input, tokens_output, images_count
  )
  values (
    p_user, current_date,
    coalesce(p_tokens_input, 0), coalesce(p_tokens_output, 0), coalesce(p_images, 0)
  )
  on conflict (user_id, day) do update
    set tokens_input = u.tokens_input + coalesce(p_tokens_input, 0),
        tokens_output = u.tokens_output + coalesce(p_tokens_output, 0),
        images_count = u.images_count + coalesce(p_images, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Estas duas sao para a Edge Function (service_role), nunca para o navegador.
-- Postgres concede EXECUTE a PUBLIC por padrao, então revogar e necessario.
-- ---------------------------------------------------------------------------
revoke execute on function public.consume_turn_quota(uuid) from public, anon, authenticated;
revoke execute on function public.record_turn_tokens(uuid, integer, integer, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- my_quota_today: o que a UI precisa para mostrar quanto resta.
--
-- security invoker + auth.uid() garante que cada um ve so o proprio consumo.
-- ---------------------------------------------------------------------------
create function public.my_quota_today()
returns table (
  turns_used integer,
  turns_limit integer,
  turns_remaining integer
)
language sql
security invoker
set search_path = ''
stable
as $$
  select
    coalesce(u.turns_count, 0) as turns_used,
    p.daily_turn_limit as turns_limit,
    greatest(p.daily_turn_limit - coalesce(u.turns_count, 0), 0) as turns_remaining
  from public.profiles p
  left join public.usage_daily u
    on u.user_id = p.id and u.day = current_date
  where p.id = auth.uid();
$$;
