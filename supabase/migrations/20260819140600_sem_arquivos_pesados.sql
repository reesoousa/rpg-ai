-- Deixa de armazenar arquivo pesado no Supabase.
--
-- Motivo: o plano free da 1 GB de Storage. Um PDF de livro come 20-40 MB e
-- cada imagem de cena 200-400 KB — enche rapido, e nenhum dos dois precisa
-- ficar guardado.
--
-- O que fica no lugar:
--   PDF     -> apagado apos a ingestao. O que importa e o rules_digest.
--   Imagem  -> devolvida na resposta e guardada no IndexedDB do navegador.
--              O banco guarda apenas o PROMPT, que e texto e ocupa nada.

-- ---------------------------------------------------------------------------
-- Bucket de cenas
--
-- Ele nao e criado (ver 20260819140500). Se existir de uma aplicacao anterior
-- desta migration, precisa ser removido pelo painel do Storage: o Supabase
-- recusa `delete from storage.buckets` e `delete from storage.objects` em SQL,
-- com "Direct deletion from storage tables is not allowed".
-- ---------------------------------------------------------------------------
drop policy if exists "scenes: dono da campanha le" on storage.objects;

do $$
begin
  if exists (select 1 from storage.buckets where id = 'scenes') then
    raise notice
      'O bucket "scenes" existe e nao e mais usado. Remova pelo painel do Storage: o Supabase nao permite apagar bucket por SQL.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- turns: troca a URL pelo prompt.
--
-- Guardar o prompt e o que faz o botao "regerar" reproduzir AQUELA cena em vez
-- de sortear uma nova. Sem ele, quem perdesse a imagem perderia a cena.
-- ---------------------------------------------------------------------------
alter table public.turns
  drop column scene_image_url,
  add column scene_prompt text,
  add column scene_generated_at timestamptz;

comment on column public.turns.scene_prompt is
  'Prompt usado para gerar a imagem desta cena. Permite regerar a mesma cena; a imagem em si vive no dispositivo do jogador.';

-- ---------------------------------------------------------------------------
-- rulebooks: o arquivo e temporario, então storage_path passa a ser opcional.
-- ---------------------------------------------------------------------------
alter table public.rulebooks
  alter column storage_path drop not null,
  add column file_deleted_at timestamptz,
  add column original_size_bytes bigint;

comment on column public.rulebooks.storage_path is
  'Caminho no bucket enquanto o arquivo existe. Fica nulo depois da ingestao, quando o PDF e apagado.';
