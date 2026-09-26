-- Segurança · RLS em tudo o que authenticated alcança. A publicação automática põe migration no ar sem
-- ninguém colar SQL: uma tabela nova sem RLS (o Supabase dá ALL em tabela nova de public para anon e
-- authenticated) ficaria legível e gravável entre empresas. Este teste roda no CI, antes de publicar.
begin;

-- O que falta, em texto (null = nada falta):
--   tabela de public (inclusive particionada) sem RLS ligado;
--   view legível por authenticated sem security_invoker = on (ela leria como o dono, por cima da RLS);
--   materialized view ou tabela estrangeira legível por authenticated (não há RLS nelas).
create function pg_temp.faltas_rls() returns text language sql as $$
  select string_agg(motivo || ': ' || c.relname, '; ' order by c.relname)
    from pg_catalog.pg_class c
    cross join lateral (select case
      when c.relkind in ('r', 'p') and not c.relrowsecurity then 'tabela sem RLS'
      when c.relkind = 'v' and pg_catalog.has_table_privilege('authenticated', c.oid, 'select')
           and not coalesce('security_invoker=on' = any (c.reloptions) or 'security_invoker=true' = any (c.reloptions), false)
        then 'view sem security_invoker'
      when c.relkind in ('m', 'f') and pg_catalog.has_table_privilege('authenticated', c.oid, 'select')
        then 'materialized view ou tabela estrangeira legível por authenticated'
    end as motivo) m
   where c.relnamespace = 'public'::regnamespace and m.motivo is not null
$$;

do $$
begin
  if pg_temp.faltas_rls() is not null then
    raise exception 'RLS: %. Toda tabela nasce com enable row level security na mesma migration (docs/arquitetura.md).', pg_temp.faltas_rls();
  end if;
end $$;

-- O teste pega de verdade: tabela sem RLS e view sem security_invoker aparecem.
create table public.zz_sem_rls (id int);
create view public.zz_view_dono as select 1 as x;
grant select on public.zz_view_dono to authenticated;
do $$
begin
  if pg_temp.faltas_rls() is distinct from 'tabela sem RLS: zz_sem_rls; view sem security_invoker: zz_view_dono' then
    raise exception 'a conferência de RLS não pegou a prova: %', pg_temp.faltas_rls();
  end if;
end $$;

rollback;
