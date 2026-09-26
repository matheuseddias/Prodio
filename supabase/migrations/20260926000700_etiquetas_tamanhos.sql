-- 20260926000700 · Tamanhos de etiqueta cadastráveis (pedido do fundador em 26/09: "cada cliente tem sua
-- particularidade de tamanho"). Antes os tamanhos eram três fixos na tela de Etiquetas (50 × 30, 60 × 40 e
-- 100 × 50 mm) e o perfil da família não guardava tamanho nenhum.
--
-- O que muda:
--   1. label_sizes: tamanho por empresa (largura × altura em mm, margem, dpi da impressora 203/300/600,
--      orientação normal ou girada, colunas lado a lado no rolo e o vão entre elas), um deles padrão.
--      tenant_id + RLS; leitura para todo papel do tenant, escrita só pelas RPCs (admin).
--   2. Os três tamanhos de fábrica viram linhas editáveis de cada empresa (60 × 40 padrão): para as que já
--      existem, aqui; para as novas, pelo gatilho em tenants (como a etapa 'final' da 0005).
--   3. label_profiles.label_size_id: o perfil da família escolhe o tamanho. Nulo = o padrão da empresa, então os
--      perfis que já existem continuam iguais. FK composta (mesmo tenant); apagar o tamanho devolve os perfis ao
--      padrão (on delete set null só da coluna do tamanho).
--   4. RPCs save_label_size e delete_label_size (admin): valida com as mesmas regras do core
--      (packages/core/src/etiquetaTamanhos.ts, validarTamanho), mantém exatamente um padrão, nome sem repetir.
-- Reexecutável: create … if not exists, create or replace, drop trigger if exists antes de recriar, a FK só é
-- criada se ainda não existe, e os tamanhos de fábrica só entram em empresa sem tamanho nenhum.
-- Teste: supabase/tests/0022_etiquetas_tamanhos.test.sql.

-- ---------------------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------------------
create table if not exists public.label_sizes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nome text not null,
  largura_mm numeric(6,2) not null,
  altura_mm numeric(6,2) not null,
  margem_mm numeric(4,2) not null default 2,
  dpi int not null default 203,
  orientacao text not null default 'normal',
  colunas int not null default 1,
  espaco_colunas_mm numeric(4,2) not null default 0,
  padrao boolean not null default false,
  preset text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint label_sizes_nome_ck check (length(btrim(nome)) between 1 and 40),
  constraint label_sizes_medidas_ck check (largura_mm between 10 and 220 and altura_mm between 10 and 300),
  constraint label_sizes_margem_ck check (margem_mm between 0 and 10 and least(largura_mm, altura_mm) - 2 * margem_mm >= 8),
  constraint label_sizes_dpi_ck check (dpi in (203, 300, 600)),
  constraint label_sizes_orientacao_ck check (orientacao in ('normal', 'girada')),
  constraint label_sizes_colunas_ck check (colunas between 1 and 4 and espaco_colunas_mm between 0 and 20
    and colunas * largura_mm + (colunas - 1) * espaco_colunas_mm <= 220),
  constraint label_sizes_preset_ck check (preset is null or preset in ('50x30', '60x40', '100x50'))
);
-- Nome sem repetir (sem diferença de maiúscula) e no máximo um padrão por empresa.
create unique index if not exists label_sizes_nome_uk on public.label_sizes (tenant_id, lower(btrim(nome)));
create unique index if not exists label_sizes_padrao_uk on public.label_sizes (tenant_id) where padrao;

drop trigger if exists label_sizes_updated_at on public.label_sizes;
create trigger label_sizes_updated_at before update on public.label_sizes for each row execute function public.set_updated_at();
drop trigger if exists label_sizes_audit on public.label_sizes;
create trigger label_sizes_audit after insert or update or delete on public.label_sizes for each row execute function public.audit_trigger();

alter table public.label_sizes enable row level security;
drop policy if exists label_sizes_select on public.label_sizes;
create policy label_sizes_select on public.label_sizes for select to authenticated using (tenant_id = (select public.current_tenant_id()));
revoke all on table public.label_sizes from public, anon, authenticated;
grant select on public.label_sizes to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Tamanhos de fábrica: empresa sem tamanho nenhum ganha os três (60 × 40 padrão)
-- ---------------------------------------------------------------------------
create or replace function public.seed_label_sizes(p_tenant_id uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.label_sizes (tenant_id, nome, largura_mm, altura_mm, margem_mm, dpi, orientacao, colunas, espaco_colunas_mm, padrao, preset)
  select p_tenant_id, v.nome, v.largura, v.altura, 2, 203, 'normal', 1, 0, v.padrao, v.preset
    from (values ('50 × 30 mm', 50, 30, false, '50x30'), ('60 × 40 mm', 60, 40, true, '60x40'), ('100 × 50 mm', 100, 50, false, '100x50'))
      as v(nome, largura, altura, padrao, preset)
   where not exists (select 1 from public.label_sizes s where s.tenant_id = p_tenant_id)
$$;
revoke execute on function public.seed_label_sizes(uuid) from public, anon, authenticated;

create or replace function public.tenant_default_label_sizes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.seed_label_sizes(new.id);
  return new;
end $$;
revoke execute on function public.tenant_default_label_sizes() from public, anon, authenticated;
drop trigger if exists tenants_default_label_sizes on public.tenants;
create trigger tenants_default_label_sizes after insert on public.tenants for each row execute function public.tenant_default_label_sizes();

do $$
declare r record;
begin
  for r in select t.id from public.tenants t loop
    perform public.seed_label_sizes(r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. O perfil da família escolhe o tamanho (nulo = padrão da empresa)
-- ---------------------------------------------------------------------------
alter table public.label_profiles add column if not exists label_size_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'label_profiles_size_fk' and conrelid = 'public.label_profiles'::regclass) then
    alter table public.label_profiles add constraint label_profiles_size_fk
      foreign key (tenant_id, label_size_id) references public.label_sizes(tenant_id, id) on delete set null (label_size_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. RPCs (admin). p_tamanho: {id?, nome, largura_mm, altura_mm, margem_mm, dpi, orientacao, colunas,
--    espaco_colunas_mm, padrao}. Sem id cria; com id altera o tamanho da empresa (id de outra empresa: não achado).
-- ---------------------------------------------------------------------------
create or replace function public.save_label_size(p_tenant_id uuid, p_tamanho jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_nome text;
  v_l numeric;
  v_a numeric;
  v_m numeric;
  v_dpi int;
  v_or text;
  v_col int;
  v_esp numeric;
  v_padrao boolean;
  v_restricao text;
  n numeric;
begin
  perform public.assert_member(p_tenant_id, array['admin']::public.member_role[]);
  if p_tamanho is null or jsonb_typeof(p_tamanho) <> 'object' then raise exception 'tamanho inválido' using errcode = '22023'; end if;
  -- Um admin por vez na empresa: o padrão troca de linha sem corrida.
  perform pg_advisory_xact_lock(hashtext('label_sizes:' || p_tenant_id::text));

  if coalesce(p_tamanho ->> 'id', '') <> '' then
    if (p_tamanho ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'tamanho não encontrado' using errcode = '22023'; end if;
    v_id := (p_tamanho ->> 'id')::uuid;
    if not exists (select 1 from public.label_sizes s where s.id = v_id and s.tenant_id = p_tenant_id) then raise exception 'tamanho não encontrado' using errcode = '22023'; end if;
  end if;

  v_nome := btrim(coalesce(p_tamanho ->> 'nome', ''));
  if v_nome = '' then raise exception 'Dê um nome ao tamanho.' using errcode = '22023'; end if;
  if length(v_nome) > 40 then raise exception 'Nome com até 40 letras.' using errcode = '22023'; end if;
  v_l := case when jsonb_typeof(p_tamanho -> 'largura_mm') = 'number' then (p_tamanho ->> 'largura_mm')::numeric end;
  v_a := case when jsonb_typeof(p_tamanho -> 'altura_mm') = 'number' then (p_tamanho ->> 'altura_mm')::numeric end;
  v_m := case when jsonb_typeof(p_tamanho -> 'margem_mm') = 'number' then (p_tamanho ->> 'margem_mm')::numeric end;
  v_esp := case when jsonb_typeof(p_tamanho -> 'espaco_colunas_mm') = 'number' then (p_tamanho ->> 'espaco_colunas_mm')::numeric else 0 end;
  n := case when jsonb_typeof(p_tamanho -> 'dpi') = 'number' then (p_tamanho ->> 'dpi')::numeric end;
  v_dpi := case when n in (203, 300, 600) then n::int end;
  n := case when jsonb_typeof(p_tamanho -> 'colunas') = 'number' then (p_tamanho ->> 'colunas')::numeric else 1 end;
  v_col := case when n = trunc(n) and n between 1 and 4 then n::int end;
  v_or := coalesce(p_tamanho ->> 'orientacao', 'normal');
  v_padrao := coalesce(case when jsonb_typeof(p_tamanho -> 'padrao') = 'boolean' then (p_tamanho ->> 'padrao')::boolean end, false);

  if v_l is null or v_l < 10 or v_l > 220 then raise exception 'Largura entre 10 e 220 mm.' using errcode = '22023'; end if;
  if v_a is null or v_a < 10 or v_a > 300 then raise exception 'Altura entre 10 e 300 mm.' using errcode = '22023'; end if;
  if v_m is null or v_m < 0 or v_m > 10 then raise exception 'Margem entre 0 e 10 mm.' using errcode = '22023'; end if;
  if least(v_l, v_a) - 2 * v_m < 8 then raise exception 'Com margem de % mm sobram menos de 8 mm para imprimir: diminua a margem.', v_m using errcode = '22023'; end if;
  if v_dpi is null then raise exception 'Resolução da impressora: 203, 300 ou 600 dpi.' using errcode = '22023'; end if;
  if v_or not in ('normal', 'girada') then raise exception 'Orientação inválida.' using errcode = '22023'; end if;
  if v_col is null then raise exception 'De 1 a 4 etiquetas lado a lado.' using errcode = '22023'; end if;
  if v_esp is null or v_esp < 0 or v_esp > 20 then raise exception 'Vão entre colunas de 0 a 20 mm.' using errcode = '22023'; end if;
  if v_col * v_l + (v_col - 1) * v_esp > 220 then raise exception 'O rolo passaria de 220 mm de largura: menos colunas ou etiqueta mais estreita.' using errcode = '22023'; end if;

  begin
    if v_padrao then
      update public.label_sizes set padrao = false where tenant_id = p_tenant_id and padrao and id is distinct from v_id;
    end if;
    if v_id is null then
      insert into public.label_sizes (tenant_id, nome, largura_mm, altura_mm, margem_mm, dpi, orientacao, colunas, espaco_colunas_mm, padrao)
      values (p_tenant_id, v_nome, v_l, v_a, v_m, v_dpi, v_or, v_col, v_esp, v_padrao)
      returning id into v_id;
    else
      -- Mudou a medida de um tamanho de fábrica: ele deixa de ser "de fábrica" (preset nulo).
      update public.label_sizes
         set nome = v_nome, largura_mm = v_l, altura_mm = v_a, margem_mm = v_m, dpi = v_dpi, orientacao = v_or,
             colunas = v_col, espaco_colunas_mm = v_esp, padrao = v_padrao,
             preset = case when largura_mm = v_l and altura_mm = v_a then preset end
       where id = v_id and tenant_id = p_tenant_id;
    end if;
  exception when unique_violation then
    get stacked diagnostics v_restricao = constraint_name;
    if v_restricao = 'label_sizes_nome_uk' then raise exception 'Já existe um tamanho chamado "%".', v_nome using errcode = '23505'; end if;
    raise;
  end;

  -- Sempre exatamente um padrão: o primeiro tamanho da empresa vira padrão; desmarcar o padrão sem marcar outro, não.
  if not exists (select 1 from public.label_sizes s where s.tenant_id = p_tenant_id and s.padrao) then
    if (select count(*) from public.label_sizes s where s.tenant_id = p_tenant_id) = 1 then
      update public.label_sizes set padrao = true where id = v_id and tenant_id = p_tenant_id;
    else
      raise exception 'A empresa precisa de um tamanho padrão: marque outro como padrão em vez de desmarcar este.' using errcode = '22023';
    end if;
  end if;
  return v_id;
end $$;
revoke execute on function public.save_label_size(uuid, jsonb) from public, anon;
grant execute on function public.save_label_size(uuid, jsonb) to authenticated;

-- Apaga um tamanho que não é o padrão. Os perfis que o usavam voltam ao padrão (FK on delete set null).
create or replace function public.delete_label_size(p_tenant_id uuid, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_padrao boolean;
begin
  perform public.assert_member(p_tenant_id, array['admin']::public.member_role[]);
  perform pg_advisory_xact_lock(hashtext('label_sizes:' || p_tenant_id::text));
  select s.padrao into v_padrao from public.label_sizes s where s.id = p_id and s.tenant_id = p_tenant_id;
  if not found then raise exception 'tamanho não encontrado' using errcode = '22023'; end if;
  if v_padrao then raise exception 'O tamanho padrão não pode ser apagado: marque outro como padrão antes.' using errcode = '22023'; end if;
  delete from public.label_sizes where id = p_id and tenant_id = p_tenant_id;
end $$;
revoke execute on function public.delete_label_size(uuid, uuid) from public, anon;
grant execute on function public.delete_label_size(uuid, uuid) to authenticated;
