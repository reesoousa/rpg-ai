-- Identidade, papeis e controle de quem pode entrar.
--
-- O repositorio e publico e a anon key e visivel para qualquer visitante, logo
-- RLS nao e opcional aqui: e o unico limite real de acesso ao banco.

-- ---------------------------------------------------------------------------
-- allowlist: enquanto o projeto for pessoal, cadastro e por convite.
-- Sem isso, qualquer pessoa cria conta e passa a gastar tokens de IA pagos
-- pelo dono do projeto — vazamento de credencial pela porta da frente.
-- ---------------------------------------------------------------------------
create table public.allowlist (
  email text primary key,
  -- papel concedido no primeiro login, lido por handle_new_user()
  grant_role text not null default 'player' check (grant_role in ('player', 'master')),
  note text,
  created_at timestamptz not null default now()
);

comment on table public.allowlist is
  'Emails autorizados a criar conta. Cadastro fora desta lista e recusado por trigger.';

alter table public.allowlist enable row level security;

-- ---------------------------------------------------------------------------
-- profiles: espelha auth.users com o que a aplicacao precisa.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  role text not null default 'player' check (role in ('player', 'master')),
  created_at timestamptz not null default now()
);

comment on column public.profiles.role is
  'Autorizacao do painel do mestre. O proprio usuario NAO pode alterar esta coluna: ver grants abaixo.';

alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------------
-- Helper de autorizacao.
--
-- security definer e obrigatorio: uma policy de profiles que consultasse
-- profiles diretamente entraria em recursao infinita de RLS.
-- search_path vazio evita sequestro de resolucao de nome por schema malicioso,
-- ao custo de exigir qualificacao completa de cada objeto.
-- ---------------------------------------------------------------------------
create function public.is_master()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'master'
  );
$$;

comment on function public.is_master is
  'True se o usuario autenticado e mestre. security definer para nao recorrer em RLS.';

-- ---------------------------------------------------------------------------
-- Cadastro: recusa quem nao foi convidado.
-- ---------------------------------------------------------------------------
create function public.enforce_allowlist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.allowlist a
    where lower(a.email) = lower(new.email)
  ) then
    raise exception 'Cadastro restrito a convidados.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger enforce_allowlist_before_signup
  before insert on auth.users
  for each row
  execute function public.enforce_allowlist();

-- ---------------------------------------------------------------------------
-- Cria o profile no primeiro login, com o papel que a allowlist concedeu.
-- ---------------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  concedido text;
begin
  select a.grant_role into concedido
  from public.allowlist a
  where lower(a.email) = lower(new.email);

  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    coalesce(concedido, 'player')
  );
  return new;
end;
$$;

create trigger create_profile_after_signup
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- profiles: cada um ve o seu; o mestre ve todos.
create policy "profiles: dono le o proprio"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

create policy "profiles: mestre le todos"
  on public.profiles for select
  to authenticated
  using (public.is_master());

create policy "profiles: dono atualiza o proprio"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Nao ha policy de insert: profile nasce pelo trigger, nunca pelo cliente.
-- Nao ha policy de delete: apagar conta e operacao administrativa.

-- allowlist: apenas o mestre enxerga e administra.
create policy "allowlist: mestre administra"
  on public.allowlist for all
  to authenticated
  using (public.is_master())
  with check (public.is_master());

-- ---------------------------------------------------------------------------
-- Grants por coluna.
--
-- RLS decide QUAIS LINHAS. Grant decide QUAIS COLUNAS. Sem isto, a policy
-- "dono atualiza o proprio" permitiria ao usuario rodar
-- `update profiles set role = 'master'` e se promover a administrador.
-- ---------------------------------------------------------------------------
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

revoke all on public.allowlist from anon, authenticated;
grant select, insert, update, delete on public.allowlist to authenticated;

-- ---------------------------------------------------------------------------
-- Semente: o dono do projeto entra como mestre.
-- ---------------------------------------------------------------------------
insert into public.allowlist (email, grant_role, note)
values ('reesoousa.steam@gmail.com', 'master', 'Dono do projeto')
on conflict (email) do nothing;
