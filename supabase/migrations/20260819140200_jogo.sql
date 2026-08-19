-- Estado de jogo: campanhas, fichas, mundo e historico de turnos.
--
-- Estas tabelas sao a fonte dos pseudo-arquivos markdown montados no prompt
-- (personagem.md, estado_do_mundo.md, historico_recente.md). O historico
-- completo fica aqui; so as ultimas interacoes vao para o modelo.

-- ---------------------------------------------------------------------------
-- campaigns
-- ---------------------------------------------------------------------------
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  system_id uuid not null references public.systems (id) on delete restrict,
  adventure_id uuid references public.adventures (id) on delete set null,
  title text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'finished')),
  -- ultimo turno gravado, para gerar o proximo seq sem contar a tabela toda
  last_turn_seq integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index campaigns_user_id_idx on public.campaigns (user_id, updated_at desc);

alter table public.campaigns enable row level security;

-- ---------------------------------------------------------------------------
-- Helper de posse.
--
-- security definer para a policy de characters/turns nao depender do grant de
-- leitura do usuario em campaigns.
-- ---------------------------------------------------------------------------
create function public.owns_campaign(campaign uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.campaigns c
    where c.id = campaign
      and c.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- characters: a ficha. Vira personagem.md no prompt.
-- ---------------------------------------------------------------------------
create table public.characters (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  name text not null,
  concept text,
  level integer not null default 1 check (level > 0),
  hp_current integer not null default 10,
  hp_max integer not null default 10 check (hp_max > 0),
  -- formato varia por sistema: nao cabe em colunas fixas
  attributes jsonb not null default '{}'::jsonb,
  skills jsonb not null default '[]'::jsonb,
  inventory jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- uma ficha por campanha: o jogo e solo
  unique (campaign_id)
);

-- hp_current pode passar de hp_max? Nao. E pode ser negativo? Tambem nao.
alter table public.characters
  add constraint characters_hp_dentro_do_limite
  check (hp_current >= 0 and hp_current <= hp_max);

alter table public.characters enable row level security;

-- ---------------------------------------------------------------------------
-- world_state: vira estado_do_mundo.md.
--
-- world_clock e a hora ficticia dentro do jogo. Eventos de background
-- acontecem em funcao do tempo gasto, entao o relogio e estado, nao enfeite.
-- ---------------------------------------------------------------------------
create table public.world_state (
  campaign_id uuid primary key references public.campaigns (id) on delete cascade,
  current_location text,
  location_description text,
  present_npcs jsonb not null default '[]'::jsonb,
  weather text,
  world_clock timestamptz not null default '2000-01-01 08:00:00+00',
  -- gatilhos e consequencias persistentes: "o taverneiro te deve um favor"
  flags jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.world_state enable row level security;

-- ---------------------------------------------------------------------------
-- turns: historico completo. As ultimas linhas viram historico_recente.md.
-- ---------------------------------------------------------------------------
create table public.turns (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  seq integer not null,
  turn_type text not null check (turn_type in ('speak', 'act', 'continue', 'opening')),
  player_input text,
  -- markdown cru do mestre. E isto que o botao copiar entrega ao jogador.
  narrative text not null,
  -- o JSON oculto do turno: hp_change, current_location, time_passed_minutes...
  state_delta jsonb not null default '{}'::jsonb,
  scene_image_url text,
  tokens_input integer,
  tokens_output integer,
  model text,
  created_at timestamptz not null default now(),
  unique (campaign_id, seq)
);

create index turns_campaign_seq_desc_idx on public.turns (campaign_id, seq desc);

alter table public.turns enable row level security;

-- ---------------------------------------------------------------------------
-- Policies — tudo restrito ao dono da campanha.
-- ---------------------------------------------------------------------------
create policy "campaigns: dono acessa"
  on public.campaigns for select
  to authenticated
  using (user_id = auth.uid());

create policy "campaigns: dono cria"
  on public.campaigns for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "campaigns: dono altera"
  on public.campaigns for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "campaigns: dono apaga"
  on public.campaigns for delete
  to authenticated
  using (user_id = auth.uid());

create policy "characters: dono da campanha acessa"
  on public.characters for all
  to authenticated
  using (public.owns_campaign(campaign_id))
  with check (public.owns_campaign(campaign_id));

create policy "world_state: dono da campanha acessa"
  on public.world_state for all
  to authenticated
  using (public.owns_campaign(campaign_id))
  with check (public.owns_campaign(campaign_id));

-- Turnos: leitura livre para o dono, escrita nao.
--
-- Quem grava turno e a Edge Function (service_role), depois de conferir quota
-- e chamar o modelo. Se o cliente pudesse inserir, poderia forjar narrativa e
-- state_delta — ou seja, se curar de graca e se teletransportar.
create policy "turns: dono da campanha le"
  on public.turns for select
  to authenticated
  using (public.owns_campaign(campaign_id));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on public.campaigns from anon, authenticated;
grant select, delete on public.campaigns to authenticated;

-- Grants por coluna, listando o que o cliente PODE tocar.
--
-- Nao da para conceder update na tabela e revogar colunas depois: no Postgres,
-- revogar privilegio de coluna nao subtrai do privilegio de tabela, e o cliente
-- continuaria podendo escrever em last_turn_seq. A unica forma correta e nunca
-- conceder o privilegio de tabela.
grant insert (user_id, system_id, adventure_id, title) on public.campaigns to authenticated;
grant update (title, status, adventure_id) on public.campaigns to authenticated;

-- Nota deliberada: a ficha E editavel pelo cliente.
--
-- O jogo e solo, então "trapacear" no HP nao prejudica terceiro nem gera custo.
-- E o wizard de criacao de personagem precisa escrever attributes e hp_max.
-- turns, ao contrario, fica bloqueado: e o historico canonico que alimenta o
-- prompt, e narrativa forjada corromperia o contexto enviado ao modelo.
revoke all on public.characters from anon, authenticated;
grant select, insert, update, delete on public.characters to authenticated;

revoke all on public.world_state from anon, authenticated;
grant select, insert, update, delete on public.world_state to authenticated;

revoke all on public.turns from anon, authenticated;
grant select on public.turns to authenticated;

-- ---------------------------------------------------------------------------
-- updated_at automatico
-- ---------------------------------------------------------------------------
create trigger campaigns_touch_updated_at
  before update on public.campaigns
  for each row execute function public.touch_updated_at();

create trigger characters_touch_updated_at
  before update on public.characters
  for each row execute function public.touch_updated_at();

create trigger world_state_touch_updated_at
  before update on public.world_state
  for each row execute function public.touch_updated_at();
