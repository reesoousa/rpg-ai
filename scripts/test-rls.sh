#!/usr/bin/env bash
# Testa se as policies realmente barram o que deveriam barrar.
#
# Migration que compila nao e migration que protege. Cada caso abaixo e um
# ataque concreto que o repositorio publico torna plausivel.
#
# Uso: bash scripts/test-rls.sh
set -uo pipefail

CONTAINER=rpgai-rlstest
IMAGE=postgres:17-alpine
PASS=0
FAIL=0

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
for _ in $(seq 1 30); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

psql() { docker exec -i "$CONTAINER" psql -U postgres -q -At "$@"; }

psql -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  raw_user_meta_data jsonb default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
SQL

for f in supabase/migrations/*.sql; do
  psql -v ON_ERROR_STOP=1 -f - < "$f" >/dev/null || { echo "migration falhou: $f"; exit 1; }
done

# --- cenario: dois usuarios convidados, um mestre e um jogador comum ---
psql -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
insert into public.allowlist (email, grant_role) values ('jogador@teste.com', 'player');
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'reesoousa.steam@gmail.com'),
  ('22222222-2222-2222-2222-222222222222', 'jogador@teste.com');
insert into public.systems (id, slug, name, is_published) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'fabula-ultima', 'Fabula Ultima', true),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'rascunho', 'Sistema Oculto', false);
insert into public.campaigns (id, user_id, system_id, title) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Campanha do mestre');
SQL

# roda SQL como um usuario autenticado especifico
como_usuario() {
  local uid="$1"; shift
  docker exec -i "$CONTAINER" psql -U postgres -q -At <<SQL 2>&1
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '$uid', true);
$(cat)
commit;
SQL
}

como_anon() {
  docker exec -i "$CONTAINER" psql -U postgres -q -At <<SQL 2>&1
begin;
set local role anon;
$(cat)
commit;
SQL
}

verifica() {
  local nome="$1" esperado="$2" obtido="$3"
  if [[ "$obtido" == *"$esperado"* ]]; then
    echo "  PASS  $nome"; PASS=$((PASS+1))
  else
    echo "  FAIL  $nome"
    echo "        esperava conter: $esperado"
    echo "        obteve:          $(echo "$obtido" | tr '\n' ' ' | cut -c1-160)"
    FAIL=$((FAIL+1))
  fi
}

echo ""
echo "=== Cadastro ==="

r=$(psql <<'SQL' 2>&1
insert into auth.users (email) values ('invasor@exemplo.com');
SQL
)
verifica "signup fora da allowlist e recusado" "Cadastro restrito a convidados" "$r"

r=$(psql <<'SQL' 2>&1
select role from public.profiles where id = '11111111-1111-1111-1111-111111111111';
SQL
)
verifica "allowlist concede papel de mestre no primeiro login" "master" "$r"

r=$(psql <<'SQL' 2>&1
select role from public.profiles where id = '22222222-2222-2222-2222-222222222222';
SQL
)
verifica "convidado comum entra como jogador" "player" "$r"

echo ""
echo "=== Escalada de privilegio ==="

r=$(como_usuario 22222222-2222-2222-2222-222222222222 <<'SQL'
update public.profiles set role = 'master' where id = '22222222-2222-2222-2222-222222222222';
SQL
)
verifica "jogador NAO consegue se promover a mestre" "permission denied" "$r"

r=$(como_usuario 22222222-2222-2222-2222-222222222222 <<'SQL'
update public.profiles set display_name = 'Nome Novo' where id = '22222222-2222-2222-2222-222222222222';
select display_name from public.profiles where id = '22222222-2222-2222-2222-222222222222';
SQL
)
verifica "jogador consegue mudar o proprio nome" "Nome Novo" "$r"

r=$(como_usuario 22222222-2222-2222-2222-222222222222 <<'SQL'
update public.profiles set daily_turn_limit = 99999 where id = '22222222-2222-2222-2222-222222222222';
SQL
)
verifica "jogador NAO consegue aumentar a propria quota" "permission denied" "$r"

echo ""
echo "=== Isolamento entre jogadores ==="

r=$(como_usuario 22222222-2222-2222-2222-222222222222 <<'SQL'
select count(*) from public.campaigns;
SQL
)
verifica "jogador nao ve campanha de outro" "0" "$r"

r=$(como_usuario 11111111-1111-1111-1111-111111111111 <<'SQL'
select count(*) from public.campaigns;
SQL
)
verifica "dono ve a propria campanha" "1" "$r"

r=$(como_usuario 22222222-2222-2222-2222-222222222222 <<'SQL'
insert into public.characters (campaign_id, name)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'Ficha Invasora');
SQL
)
verifica "jogador nao cria ficha em campanha alheia" "violates row-level security" "$r"

echo ""
echo "=== Vitrine publica ==="

r=$(como_anon <<'SQL'
select count(*) from public.systems;
SQL
)
verifica "anon ve apenas sistema publicado (1 de 2)" "1" "$r"

r=$(como_anon <<'SQL'
select count(*) from public.campaigns;
SQL
)
verifica "anon nem alcanca campaigns (sem grant)" "permission denied" "$r"

r=$(como_anon <<'SQL'
select count(*) from public.rulebooks;
SQL
)
verifica "anon nem alcanca rulebooks (sem grant)" "permission denied" "$r"

r=$(como_usuario 22222222-2222-2222-2222-222222222222 <<'SQL'
select source_text from public.adventures limit 1;
SQL
)
verifica "source_text da aventura nao vaza para o cliente" "permission denied" "$r"

echo ""
echo "=== Integridade da narrativa ==="

r=$(como_usuario 11111111-1111-1111-1111-111111111111 <<'SQL'
insert into public.turns (campaign_id, seq, turn_type, narrative)
values ('bbbbbbbb-0000-0000-0000-000000000001', 1, 'act', 'Eu me curo e viro rei.');
SQL
)
verifica "cliente NAO forja turno (nem na propria campanha)" "permission denied for table turns" "$r"

r=$(como_usuario 11111111-1111-1111-1111-111111111111 <<'SQL'
update public.campaigns set last_turn_seq = 999
where id = 'bbbbbbbb-0000-0000-0000-000000000001';
SQL
)
verifica "cliente nao mexe em last_turn_seq" "permission denied" "$r"

echo ""
echo "=== Quota de custo ==="

r=$(como_usuario 22222222-2222-2222-2222-222222222222 <<'SQL'
select public.consume_turn_quota('22222222-2222-2222-2222-222222222222');
SQL
)
verifica "cliente nao chama consume_turn_quota direto" "permission denied for function" "$r"

r=$(psql <<'SQL' 2>&1
update public.profiles set daily_turn_limit = 3
  where id = '22222222-2222-2222-2222-222222222222';
select public.consume_turn_quota('22222222-2222-2222-2222-222222222222');
select public.consume_turn_quota('22222222-2222-2222-2222-222222222222');
select public.consume_turn_quota('22222222-2222-2222-2222-222222222222');
SQL
)
verifica "3 turnos dentro do limite passam (resta 0)" "0" "$r"

r=$(psql <<'SQL' 2>&1
select public.consume_turn_quota('22222222-2222-2222-2222-222222222222');
SQL
)
verifica "4o turno estoura o limite" "Limite diario de 3 turnos atingido" "$r"

r=$(como_usuario 22222222-2222-2222-2222-222222222222 <<'SQL'
select turns_used || '/' || turns_limit from public.my_quota_today();
SQL
)
verifica "jogador ve o proprio consumo" "3/3" "$r"

r=$(como_usuario 22222222-2222-2222-2222-222222222222 <<'SQL'
update public.usage_daily set turns_count = 0
where user_id = '22222222-2222-2222-2222-222222222222';
SQL
)
verifica "jogador nao zera o proprio contador" "permission denied for table usage_daily" "$r"

echo ""
echo "==================================="
echo " $PASS passaram, $FAIL falharam"
echo "==================================="
[ "$FAIL" -gt 0 ] && exit 1
exit 0
