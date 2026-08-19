-- Catalogo publico: sistemas, aventuras, livros de regras e entidades extraidas.
--
-- Este e o conteudo da area deslogada (vitrine). Leitura liberada para `anon`,
-- mas somente do que esta publicado. Escrita e exclusiva do mestre.

-- ---------------------------------------------------------------------------
-- systems: Fabula Ultima, etc.
-- ---------------------------------------------------------------------------
create table public.systems (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  tagline text,
  description text,
  publisher text,
  cover_url text,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.systems enable row level security;

-- ---------------------------------------------------------------------------
-- adventures: aventuras prontas de um sistema.
--
-- gemini_cache_name guarda o recurso de Context Caching da API do Gemini
-- (formato `cachedContents/<id>`), para congelar o texto da aventura e nao
-- reenviar o documento a cada turno.
-- ---------------------------------------------------------------------------
create table public.adventures (
  id uuid primary key default gen_random_uuid(),
  system_id uuid not null references public.systems (id) on delete cascade,
  slug text not null unique,
  title text not null,
  synopsis text,
  cover_url text,
  -- texto integral que alimenta a fabrica de campanhas e o cache
  source_text text,
  gemini_cache_name text,
  gemini_cache_expires_at timestamptz,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index adventures_system_id_idx on public.adventures (system_id);

alter table public.adventures enable row level security;

-- ---------------------------------------------------------------------------
-- rulebooks: PDFs dos livros base, no Storage.
--
-- Nunca publico: e material licenciado. Somente o mestre acessa, e o conteudo
-- chega ao modelo pela Edge Function, nao pelo navegador.
-- ---------------------------------------------------------------------------
create table public.rulebooks (
  id uuid primary key default gen_random_uuid(),
  system_id uuid not null references public.systems (id) on delete cascade,
  title text not null,
  storage_path text not null,
  page_count integer,
  gemini_cache_name text,
  gemini_cache_expires_at timestamptz,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index rulebooks_system_id_idx on public.rulebooks (system_id);

alter table public.rulebooks enable row level security;

-- ---------------------------------------------------------------------------
-- adventure_entities: saida da fabrica de campanhas.
--
-- O LLM extrai locais, NPCs e itens do texto solto em JSON estrito; isso vira
-- linha aqui e depois alimenta o estado_do_mundo.md enviado no prompt.
-- ---------------------------------------------------------------------------
create table public.adventure_entities (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references public.adventures (id) on delete cascade,
  kind text not null check (kind in ('location', 'npc', 'item', 'faction', 'event')),
  name text not null,
  summary text,
  -- campos variaveis por tipo: atitude do NPC, saidas do local, efeito do item
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index adventure_entities_adventure_id_kind_idx
  on public.adventure_entities (adventure_id, kind);

alter table public.adventure_entities enable row level security;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- Vitrine: `anon` le apenas o publicado.
create policy "systems: publicado e visivel a todos"
  on public.systems for select
  to anon, authenticated
  using (is_published);

create policy "systems: mestre administra"
  on public.systems for all
  to authenticated
  using (public.is_master())
  with check (public.is_master());

create policy "adventures: publicada e visivel a todos"
  on public.adventures for select
  to anon, authenticated
  using (
    is_published
    and exists (
      select 1 from public.systems s
      where s.id = adventures.system_id and s.is_published
    )
  );

create policy "adventures: mestre administra"
  on public.adventures for all
  to authenticated
  using (public.is_master())
  with check (public.is_master());

-- Entidades seguem a visibilidade da aventura.
create policy "adventure_entities: visiveis com a aventura"
  on public.adventure_entities for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.adventures a
      where a.id = adventure_entities.adventure_id
        and a.is_published
    )
  );

create policy "adventure_entities: mestre administra"
  on public.adventure_entities for all
  to authenticated
  using (public.is_master())
  with check (public.is_master());

-- Livros de regras: sem leitura publica, nem para usuario logado comum.
create policy "rulebooks: somente mestre"
  on public.rulebooks for all
  to authenticated
  using (public.is_master())
  with check (public.is_master());

-- ---------------------------------------------------------------------------
-- Grants
--
-- `source_text` fica fora do grant de leitura: e o texto integral da aventura,
-- que nao deve trafegar para o navegador. Ele e lido pela Edge Function, que
-- opera com service_role e ignora estes grants.
-- ---------------------------------------------------------------------------
revoke all on public.systems from anon, authenticated;
grant select on public.systems to anon, authenticated;
grant insert, update, delete on public.systems to authenticated;

revoke all on public.adventures from anon, authenticated;
grant select (
  id, system_id, slug, title, synopsis, cover_url,
  gemini_cache_name, gemini_cache_expires_at,
  is_published, created_at, updated_at
) on public.adventures to anon, authenticated;
grant insert, update, delete on public.adventures to authenticated;

revoke all on public.adventure_entities from anon, authenticated;
grant select on public.adventure_entities to anon, authenticated;
grant insert, update, delete on public.adventure_entities to authenticated;

revoke all on public.rulebooks from anon, authenticated;
grant select, insert, update, delete on public.rulebooks to authenticated;

-- ---------------------------------------------------------------------------
-- updated_at automatico
-- ---------------------------------------------------------------------------
create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger systems_touch_updated_at
  before update on public.systems
  for each row execute function public.touch_updated_at();

create trigger adventures_touch_updated_at
  before update on public.adventures
  for each row execute function public.touch_updated_at();
