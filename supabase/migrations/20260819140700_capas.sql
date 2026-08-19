-- Capas de sistemas e aventuras.
--
-- Estas SIM ficam no Supabase, ao contrario dos PDFs e das cenas: sao poucas
-- (uma por sistema, uma por aventura), pequenas (limite de 2 MB) e precisam
-- estar visiveis na vitrine para quem nem tem conta.
--
-- Por isso o bucket e PUBLICO: URL permanente, sem assinatura para expirar, e
-- cacheavel pelo CDN. Uma capa nao e segredo — ela existe para ser vista.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'covers',
  'covers',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
  set public = true,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

-- Leitura publica vem do bucket ser publico. A escrita continua restrita:
-- so o mestre sobe capa, senao qualquer usuario logado poderia trocar a arte
-- da vitrine.
create policy "covers: somente mestre escreve"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'covers' and public.is_master());

create policy "covers: somente mestre atualiza"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'covers' and public.is_master())
  with check (bucket_id = 'covers' and public.is_master());

create policy "covers: somente mestre apaga"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'covers' and public.is_master());

-- ---------------------------------------------------------------------------
-- As tabelas ja tinham cover_url. O que faltava era o caminho no bucket, para
-- conseguir apagar o arquivo antigo quando a capa e trocada — sem isso, cada
-- troca deixaria um orfao ocupando espaco.
-- ---------------------------------------------------------------------------
alter table public.systems add column cover_path text;
alter table public.adventures add column cover_path text;

comment on column public.systems.cover_path is
  'Caminho no bucket covers. Guardado para poder apagar o arquivo antigo ao trocar a capa.';

-- cover_path entra no grant de leitura junto com cover_url: o admin precisa
-- dele para trocar a capa, e nao ha risco em expor um caminho de bucket publico.
grant select (cover_path) on public.systems to anon, authenticated;
grant select (cover_path) on public.adventures to anon, authenticated;
