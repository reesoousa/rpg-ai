#!/usr/bin/env bash
# Valida as migrations num Postgres limpo, sem precisar do stack completo do
# Supabase (que baixaria varios GB de imagens).
#
# Os objetos que o Supabase fornece — schema auth, auth.uid(), os roles anon /
# authenticated / service_role — sao recriados como shims minimos, o bastante
# para o SQL das migrations compilar e as policies serem aceitas.
#
# Uso: bash scripts/validate-migrations.sh
set -euo pipefail

CONTAINER=rpgai-pgcheck
IMAGE=postgres:17-alpine

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "==> subindo $IMAGE"
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null

echo -n "==> aguardando postgres"
for _ in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  echo -n "."; sleep 1
done
echo " pronto"

echo "==> criando shims do supabase"
docker exec -i "$CONTAINER" psql -U postgres -q -v ON_ERROR_STOP=1 <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  raw_user_meta_data jsonb default '{}'::jsonb
);

-- No Supabase real isto le o JWT da requisicao.
create function auth.uid() returns uuid
  language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

-- Shims do Storage: objetos que o Supabase real cria e as migrations usam.
create schema storage;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid
);
alter table storage.objects enable row level security;

-- Devolve os segmentos do caminho sem o nome do arquivo.
create function storage.foldername(name text) returns text[]
language sql immutable as $fn$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$fn$;

grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
SQL

echo "==> aplicando migrations"
FAIL=0
for f in supabase/migrations/*.sql; do
  name=$(basename "$f")
  if docker exec -i "$CONTAINER" psql -U postgres -q -v ON_ERROR_STOP=1 -f - < "$f" 2>/tmp/pgerr; then
    echo "    ok   $name"
  else
    echo "    FALHOU $name"
    sed 's/^/           /' /tmp/pgerr
    FAIL=1
    break
  fi
done

[ "$FAIL" = "1" ] && exit 1

echo "==> conferindo que RLS esta ligada em toda tabela"
docker exec -i "$CONTAINER" psql -U postgres -At <<'SQL'
select case when count(*) = 0
  then 'ok   todas as tabelas com RLS'
  else 'FALHOU sem RLS: ' || string_agg(relname, ', ')
end
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
SQL

echo "==> conferindo que toda tabela tem ao menos uma policy"
docker exec -i "$CONTAINER" psql -U postgres -At <<'SQL'
select case when count(*) = 0
  then 'ok   todas as tabelas com policy'
  else 'ATENCAO sem policy: ' || string_agg(c.relname, ', ')
end
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and not exists (select 1 from pg_policy p where p.polrelid = c.oid);
SQL

echo "==> resumo"
docker exec -i "$CONTAINER" psql -U postgres <<'SQL'
select c.relname as tabela,
       c.relrowsecurity as rls,
       count(p.polname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
group by 1, 2
order by 1;
SQL

echo "==> OK: migrations validas"
