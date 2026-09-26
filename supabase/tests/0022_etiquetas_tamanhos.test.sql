-- Tamanhos de etiqueta (20260926000700_etiquetas_tamanhos.sql): os três de fábrica nascem com a empresa, as RPCs
-- save_label_size/delete_label_size validam como o core (etiquetaTamanhos.ts, validarTamanho), mantêm um padrão só,
-- o perfil da família aponta para um tamanho da própria empresa, apagar o tamanho devolve o perfil ao padrão, e
-- papéis e isolamento entre empresas.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000022a', 'ana22@a.com'),
  ('00000000-0000-0000-0000-00000000022b', 'bento22@b.com'),
  ('00000000-0000-0000-0000-00000000022c', 'carla22@a.com'),
  ('00000000-0000-0000-0000-00000000022d', 'davi22@a.com');
select auth.test_login('00000000-0000-0000-0000-00000000022a');
select public.create_tenant('Fábrica A', 'fabrica-a22', '11.111.111/0001-11') as tenant_a \gset
select auth.test_logout();
select auth.test_login('00000000-0000-0000-0000-00000000022b');
select public.create_tenant('Fábrica B', 'fabrica-b22', '22.222.222/0001-22') as tenant_b \gset
select auth.test_logout();
select set_config('test.tenant_a', :'tenant_a', false), set_config('test.tenant_b', :'tenant_b', false);
insert into public.memberships (tenant_id, user_id, role, accepted_at) values
  (:'tenant_a', '00000000-0000-0000-0000-00000000022c', 'producao', now()),
  (:'tenant_a', '00000000-0000-0000-0000-00000000022d', 'leitura', now());
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_a') where id in ('00000000-0000-0000-0000-00000000022a', '00000000-0000-0000-0000-00000000022c', '00000000-0000-0000-0000-00000000022d');
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_b') where id = '00000000-0000-0000-0000-00000000022b';
insert into public.label_profiles (tenant_id, familia, prefixo) values (:'tenant_a', 'Espelho', 'EH'), (:'tenant_b', 'Mesa', 'MS');

-- ---------------------------------------------------------------------------
-- Os três tamanhos de fábrica nascem com a empresa (gatilho em tenants); o perfil existente fica no padrão.
-- ---------------------------------------------------------------------------
do $$
declare v_t uuid := current_setting('test.tenant_a')::uuid;
begin
  if (select string_agg(nome || ':' || padrao, ' ' order by largura_mm) from public.label_sizes where tenant_id = v_t) <> '50 × 30 mm:false 60 × 40 mm:true 100 × 50 mm:false' then
    raise exception 'presets: %', (select string_agg(nome || ':' || padrao, ' ' order by largura_mm) from public.label_sizes where tenant_id = v_t);
  end if;
  if exists (select 1 from public.label_sizes where tenant_id = v_t and (margem_mm <> 2 or dpi <> 203 or orientacao <> 'normal' or colunas <> 1 or preset is null)) then
    raise exception 'presets com valores de fábrica';
  end if;
  if (select label_size_id from public.label_profiles where tenant_id = v_t) is not null then raise exception 'perfil existente deveria ficar no padrão (nulo)'; end if;
  -- rodar a semeadura de novo não duplica (é o que a reaplicação da migration faz)
  perform public.seed_label_sizes(v_t);
  if (select count(*) from public.label_sizes where tenant_id = v_t) <> 3 then raise exception 'seed_label_sizes duplicou'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Admin de A: cria, valida, troca o padrão, aponta o perfil e apaga.
-- ---------------------------------------------------------------------------
select auth.test_login('00000000-0000-0000-0000-00000000022a');
do $$
declare
  v_t uuid := current_setting('test.tenant_a')::uuid;
  v_rolo uuid;
  v_60 uuid := (select id from public.label_sizes where tenant_id = v_t and preset = '60x40');
  v_b uuid := (select id from public.label_sizes where tenant_id = current_setting('test.tenant_b')::uuid limit 1);
  v_ok jsonb := '{"nome":"Rolo 2 colunas","largura_mm":33,"altura_mm":22,"margem_mm":1.5,"dpi":300,"orientacao":"normal","colunas":2,"espaco_colunas_mm":2,"padrao":false}';
  r record;
begin
  if v_b is not null then raise exception 'admin de A enxerga tamanho de B pela RLS'; end if;
  v_rolo := public.save_label_size(v_t, v_ok);
  select * into r from public.label_sizes where id = v_rolo;
  if r.tenant_id <> v_t or r.largura_mm <> 33 or r.margem_mm <> 1.5 or r.dpi <> 300 or r.colunas <> 2 or r.espaco_colunas_mm <> 2 or r.padrao or r.preset is not null then
    raise exception 'tamanho gravado: %', r;
  end if;
  if not exists (select 1 from public.audit_log a where a.entidade = 'label_sizes' and a.entidade_id = v_rolo::text and a.acao = 'insert' and a.user_id = auth.uid()) then
    raise exception 'criação sem rastro no audit_log';
  end if;

  -- Regras (as mesmas mensagens do core)
  declare
    casos jsonb := jsonb_build_array(
      jsonb_build_array(v_ok || '{"nome":"  "}', 'Dê um nome'),
      jsonb_build_array(v_ok || jsonb_build_object('nome', repeat('x', 41)), 'até 40'),
      jsonb_build_array(v_ok || '{"nome":"x","largura_mm":9}', 'Largura entre 10 e 220'),
      jsonb_build_array(v_ok || '{"nome":"x","largura_mm":"33"}', 'Largura entre 10 e 220'),
      jsonb_build_array(v_ok || '{"nome":"x","altura_mm":301}', 'Altura entre 10 e 300'),
      jsonb_build_array(v_ok || '{"nome":"x","margem_mm":11}', 'Margem entre 0 e 10'),
      jsonb_build_array(v_ok || '{"nome":"x","largura_mm":20,"altura_mm":15,"margem_mm":4}', 'sobram menos de 8 mm'),
      jsonb_build_array(v_ok || '{"nome":"x","dpi":250}', '203, 300 ou 600'),
      jsonb_build_array(v_ok || '{"nome":"x","orientacao":"deitada"}', 'Orientação inválida'),
      jsonb_build_array(v_ok || '{"nome":"x","colunas":5}', 'De 1 a 4'),
      jsonb_build_array(v_ok || '{"nome":"x","colunas":1.5}', 'De 1 a 4'),
      jsonb_build_array(v_ok || '{"nome":"x","espaco_colunas_mm":21}', 'Vão entre colunas'),
      jsonb_build_array(v_ok || '{"nome":"x","largura_mm":60,"colunas":4,"espaco_colunas_mm":3}', 'passaria de 220 mm'),
      jsonb_build_array('[]'::jsonb, 'tamanho inválido'),
      jsonb_build_array(v_ok || '{"id":"nao-e-uuid"}', 'não encontrado'),
      jsonb_build_array(v_ok || '{"id":"00000000-0000-0000-0000-000000000000"}', 'não encontrado'));
    c jsonb;
  begin
    for c in select * from jsonb_array_elements(casos) loop
      begin
        perform public.save_label_size(v_t, c -> 0);
        raise exception 'deveria recusar: %', c -> 0;
      exception when invalid_parameter_value then
        if sqlerrm not like '%' || (c ->> 1) || '%' then raise exception 'mensagem "%" não tem "%"', sqlerrm, c ->> 1; end if;
      end;
    end loop;
  end;
  -- nome repetido, sem diferença de maiúscula e espaços
  begin
    perform public.save_label_size(v_t, v_ok || '{"nome":" rolo 2 COLUNAS "}');
    raise exception 'nome repetido deveria ser recusado';
  exception when unique_violation then
    if sqlerrm not like 'Já existe um tamanho chamado%' then raise exception 'mensagem do nome repetido: %', sqlerrm; end if;
  end;
  -- tamanho de fábrica: mudar a margem mantém "de fábrica"; mudar a medida tira
  perform public.save_label_size(v_t, jsonb_build_object('id', v_60, 'nome', '60 × 40 mm', 'largura_mm', 60, 'altura_mm', 40, 'margem_mm', 3, 'dpi', 203, 'padrao', true));
  if (select preset from public.label_sizes where id = v_60) is distinct from '60x40' then raise exception 'margem nova não deveria tirar o preset'; end if;
  perform public.save_label_size(v_t, jsonb_build_object('id', v_60, 'nome', '60 × 40 mm', 'largura_mm', 62, 'altura_mm', 40, 'margem_mm', 3, 'dpi', 203, 'padrao', true));
  if (select preset from public.label_sizes where id = v_60) is not null then raise exception 'medida nova deveria tirar o preset'; end if;
  -- o próprio tamanho pode manter o nome
  perform public.save_label_size(v_t, v_ok || jsonb_build_object('id', v_rolo, 'margem_mm', 1));
  if (select margem_mm from public.label_sizes where id = v_rolo) <> 1 then raise exception 'edição não gravou'; end if;

  -- Padrão: marcar o rolo tira o 60 × 40; desmarcar o único padrão é recusado
  perform public.save_label_size(v_t, v_ok || jsonb_build_object('id', v_rolo, 'padrao', true));
  if (select count(*) from public.label_sizes where tenant_id = v_t and padrao) <> 1 or not (select padrao from public.label_sizes where id = v_rolo) then
    raise exception 'deveria haver um padrão só, o rolo';
  end if;
  begin
    perform public.save_label_size(v_t, v_ok || jsonb_build_object('id', v_rolo, 'padrao', false));
    raise exception 'desmarcar o único padrão deveria ser recusado';
  exception when invalid_parameter_value then
    if sqlerrm not like '%precisa de um tamanho padrão%' then raise exception 'mensagem: %', sqlerrm; end if;
  end;

  -- Perfil aponta para o 60 × 40 (escrita direta, RLS de label_profiles); apagar o padrão é recusado
  update public.label_profiles set label_size_id = v_60 where tenant_id = v_t and familia = 'Espelho';
  begin
    perform public.delete_label_size(v_t, v_rolo);
    raise exception 'apagar o padrão deveria ser recusado';
  exception when invalid_parameter_value then
    if sqlerrm not like 'O tamanho padrão não pode ser apagado%' then raise exception 'mensagem: %', sqlerrm; end if;
  end;
  -- Apagar o 60 × 40 devolve o perfil ao padrão (nulo) e deixa rastro
  perform public.delete_label_size(v_t, v_60);
  if exists (select 1 from public.label_sizes where id = v_60) then raise exception 'não apagou'; end if;
  if (select label_size_id from public.label_profiles where tenant_id = v_t and familia = 'Espelho') is not null then raise exception 'perfil deveria voltar ao padrão'; end if;
  if not exists (select 1 from public.audit_log a where a.entidade = 'label_sizes' and a.entidade_id = v_60::text and a.acao = 'delete') then raise exception 'exclusão sem rastro'; end if;
  begin
    perform public.delete_label_size(v_t, v_60);
    raise exception 'apagar de novo deveria dizer não encontrado';
  exception when invalid_parameter_value then null; end;

  -- Escrita direta na tabela: negada (só RPC)
  begin
    insert into public.label_sizes (tenant_id, nome, largura_mm, altura_mm) values (v_t, 'direto', 50, 30);
    raise exception 'insert direto deveria ser negado';
  exception when insufficient_privilege then null; end;
  begin
    update public.label_sizes set margem_mm = 0 where tenant_id = v_t;
    raise exception 'update direto deveria ser negado';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.label_sizes where tenant_id = v_t;
    raise exception 'delete direto deveria ser negado';
  exception when insufficient_privilege then null; end;
end $$;
select auth.test_logout();

-- ---------------------------------------------------------------------------
-- Isolamento: B não lê, não altera, não apaga e não aponta perfil para tamanho de A (e vice-versa).
-- ---------------------------------------------------------------------------
select auth.test_login('00000000-0000-0000-0000-00000000022b');
do $$
declare
  v_a uuid := current_setting('test.tenant_a')::uuid;
  v_b uuid := current_setting('test.tenant_b')::uuid;
  v_de_a uuid;
begin
  set local role postgres;
  v_de_a := (select id from public.label_sizes where tenant_id = v_a and preset = '50x30');
  set local role authenticated;
  if exists (select 1 from public.label_sizes where tenant_id = v_a) then raise exception 'B lê tamanhos de A'; end if;
  if (select count(*) from public.label_sizes) <> 3 then raise exception 'B deveria ler só os 3 dele'; end if;
  begin
    perform public.save_label_size(v_a, '{"nome":"invasor","largura_mm":50,"altura_mm":30,"margem_mm":2,"dpi":203}');
    raise exception 'B gravou em A';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_label_size(v_b, jsonb_build_object('id', v_de_a, 'nome', 'sequestro', 'largura_mm', 50, 'altura_mm', 30, 'margem_mm', 2, 'dpi', 203));
    raise exception 'B alterou tamanho de A pelo id';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.delete_label_size(v_b, v_de_a);
    raise exception 'B apagou tamanho de A pelo id';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.delete_label_size(v_a, v_de_a);
    raise exception 'B apagou em A';
  exception when insufficient_privilege then null; end;
  begin
    update public.label_profiles set label_size_id = v_de_a where tenant_id = v_b;
    raise exception 'perfil de B apontou para tamanho de A';
  exception when foreign_key_violation then null; end;
end $$;
select auth.test_logout();
do $$ begin
  if (select nome from public.label_sizes where tenant_id = current_setting('test.tenant_a')::uuid and preset = '50x30') <> '50 × 30 mm' then raise exception 'A foi alterado por B'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Papéis em A: produção escolhe o tamanho do perfil mas não cadastra tamanho; leitura não faz nenhum dos dois.
-- ---------------------------------------------------------------------------
select auth.test_login('00000000-0000-0000-0000-00000000022c');
do $$
declare v_t uuid := current_setting('test.tenant_a')::uuid; v_50 uuid; n int;
begin
  v_50 := (select id from public.label_sizes where tenant_id = v_t and preset = '50x30');
  begin
    perform public.save_label_size(v_t, '{"nome":"produção","largura_mm":50,"altura_mm":30,"margem_mm":2,"dpi":203}');
    raise exception 'produção não cadastra tamanho';
  exception when insufficient_privilege then null; end;
  begin
    perform public.delete_label_size(v_t, v_50);
    raise exception 'produção não apaga tamanho';
  exception when insufficient_privilege then null; end;
  update public.label_profiles set label_size_id = v_50 where tenant_id = v_t and familia = 'Espelho';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'produção deveria escolher o tamanho do perfil'; end if;
end $$;
select auth.test_logout();
select auth.test_login('00000000-0000-0000-0000-00000000022d');
do $$
declare v_t uuid := current_setting('test.tenant_a')::uuid; n int;
begin
  if (select count(*) from public.label_sizes) <> 3 then raise exception 'leitura deveria ler os tamanhos'; end if;
  begin
    perform public.save_label_size(v_t, '{"nome":"leitura","largura_mm":50,"altura_mm":30,"margem_mm":2,"dpi":203}');
    raise exception 'leitura não cadastra tamanho';
  exception when insufficient_privilege then null; end;
  update public.label_profiles set label_size_id = null where tenant_id = v_t;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'leitura não altera perfil'; end if;
end $$;
select auth.test_logout();

-- ---------------------------------------------------------------------------
-- Empresa sem tamanho nenhum (dono do banco apagou): o primeiro que o admin grava vira padrão.
-- ---------------------------------------------------------------------------
update public.label_profiles set label_size_id = null where tenant_id = :'tenant_b';
delete from public.label_sizes where tenant_id = :'tenant_b';
select auth.test_login('00000000-0000-0000-0000-00000000022b');
do $$
declare v uuid;
begin
  v := public.save_label_size(current_setting('test.tenant_b')::uuid, '{"nome":"Único","largura_mm":40,"altura_mm":25,"margem_mm":1,"dpi":203,"padrao":false}');
  if not (select padrao from public.label_sizes where id = v) then raise exception 'o primeiro tamanho deveria virar padrão'; end if;
end $$;
select auth.test_logout();

-- ---------------------------------------------------------------------------
-- Privilégios: anon não executa; as funções internas não executam para authenticated.
-- ---------------------------------------------------------------------------
do $$ begin
  if has_function_privilege('anon', 'public.save_label_size(uuid,jsonb)', 'execute') or has_function_privilege('anon', 'public.delete_label_size(uuid,uuid)', 'execute') then
    raise exception 'anon executa RPC de tamanho';
  end if;
  if not has_function_privilege('authenticated', 'public.save_label_size(uuid,jsonb)', 'execute') then raise exception 'authenticated deveria executar save_label_size'; end if;
  if has_function_privilege('authenticated', 'public.seed_label_sizes(uuid)', 'execute') or has_function_privilege('authenticated', 'public.tenant_default_label_sizes()', 'execute') then
    raise exception 'funções internas de tamanho expostas';
  end if;
  if has_table_privilege('authenticated', 'public.label_sizes', 'insert') or has_table_privilege('anon', 'public.label_sizes', 'select') then raise exception 'privilégios de label_sizes'; end if;
end $$;

rollback;
