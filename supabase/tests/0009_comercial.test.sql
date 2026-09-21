-- Testes de comercial e inventário: canais e preços por tenant (soft delete limpa preços), sessão de inventário
-- que fecha só os itens divergentes com chave 'inv:', avisos, isolamento entre tenants.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000006a', 'ana6@a.com'),
  ('00000000-0000-0000-0000-00000000006b', 'bento6@b.com'),
  ('00000000-0000-0000-0000-00000000006c', 'carla6@a.com');

select auth.test_login('00000000-0000-0000-0000-00000000006a');
select public.create_tenant('Fábrica A', 'fabrica-a6', '11.111.111/0001-11') as tenant_a \gset
select auth.test_logout();
select auth.test_login('00000000-0000-0000-0000-00000000006b');
select public.create_tenant('Fábrica B', 'fabrica-b6', '22.222.222/0001-22') as tenant_b \gset
select auth.test_logout();
select set_config('test.tenant_a', :'tenant_a', false), set_config('test.tenant_b', :'tenant_b', false);
insert into public.memberships (tenant_id, user_id, role, accepted_at) values (:'tenant_a', '00000000-0000-0000-0000-00000000006c', 'leitura', now());
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_a') where id in ('00000000-0000-0000-0000-00000000006a', '00000000-0000-0000-0000-00000000006c');
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_b') where id = '00000000-0000-0000-0000-00000000006b';

-- ---------------------------------------------------------------------------
-- Cadastro base de A e saldos: MP01 100 @ 2, MP02 50 @ 1, MP03 sem saldo.
-- ---------------------------------------------------------------------------
select auth.test_login('00000000-0000-0000-0000-00000000006a');
insert into public.locations (id, tenant_id, nome) values ('40000000-0000-0000-0000-000000000006', :'tenant_a', 'Galpão');
insert into public.units (tenant_id, code, nome, kind) values (:'tenant_a', 'un', 'Unidade', 'unidade'), (:'tenant_a', 'm', 'Metro', 'comprimento');
insert into public.materials (id, tenant_id, sku, nome, unidade_compra, unidade_consumo, tamanhos_padrao) values
  ('20000000-0000-0000-0000-000000000061', :'tenant_a', 'MP01', 'Chapa', 'un', 'un', '[]'),
  ('20000000-0000-0000-0000-000000000062', :'tenant_a', 'MP02', 'Parafuso', 'un', 'un', '[]'),
  ('20000000-0000-0000-0000-000000000063', :'tenant_a', 'MP03', 'Tecido', 'un', 'm', '[{"nome":"rolo","medida":50}]');
insert into public.products (id, tenant_id, sku, nome, familia) values ('30000000-0000-0000-0000-000000000061', :'tenant_a', 'PA', 'Produto A', 'Espelho');
select public.post_stock_move(:'tenant_a', '20000000-0000-0000-0000-000000000061', '40000000-0000-0000-0000-000000000006', 'saldo_inicial', 100, 2, 'inicial', null, null, 'test6:ini:1');
select public.post_stock_move(:'tenant_a', '20000000-0000-0000-0000-000000000062', '40000000-0000-0000-0000-000000000006', 'saldo_inicial', 50, 1, 'inicial', null, null, 'test6:ini:2');

-- ---------------------------------------------------------------------------
-- Canais e preços
-- ---------------------------------------------------------------------------
do $$
declare v_t uuid := current_setting('test.tenant_a')::uuid; v_ch uuid; v_ch2 uuid; c public.channels%rowtype;
begin
  v_ch := public.upsert_channel(v_t, null, '{"nome":"Mercado Livre","preset":"mercadolivre","comissao_pct":0.12,"taxa_fixa":6,"taxa_fixa_abaixo_de":79,"frete_vendedor":[{"ateKg":1,"valor":20}],"imposto_venda_pct":0.06,"ads_pct":0.03}');
  perform set_config('test.ch', v_ch::text, false);
  select * into c from public.channels where id = v_ch;
  if c.comissao_pct <> 0.12 or c.taxa_fixa <> 6 or c.taxa_fixa_abaixo_de <> 79 or jsonb_array_length(c.frete_vendedor) <> 1 or not c.ativo then raise exception 'canal inesperado: %', to_jsonb(c); end if;
  if public.upsert_channel(v_t, v_ch, '{"nome":"Mercado Livre Clássico","comissao_pct":0.13,"ativo":false}') <> v_ch then raise exception 'upsert por id deveria manter o id'; end if;
  select * into c from public.channels where id = v_ch;
  if c.nome <> 'Mercado Livre Clássico' or c.comissao_pct <> 0.13 or c.ativo then raise exception 'canal deveria atualizar'; end if;
  v_ch2 := public.upsert_channel(v_t, null, '{"nome":"Shopee","preset":"shopee","comissao_pct":0.2}');
  begin
    perform public.upsert_channel(v_t, null, '{"nome":"Shopee"}');
    raise exception 'nome duplicado deveria falhar';
  exception when unique_violation then null; end;
  begin
    perform public.upsert_channel(v_t, null, '{"nome":""}');
    raise exception 'nome vazio deveria falhar';
  exception when invalid_parameter_value then null; end;
  -- preços
  perform public.set_product_price(v_t, '30000000-0000-0000-0000-000000000061', v_ch, 129.9);
  perform public.set_product_price(v_t, '30000000-0000-0000-0000-000000000061', v_ch2, 119.9);
  if (select preco from public.product_prices where product_id = '30000000-0000-0000-0000-000000000061' and channel_id = v_ch) <> 129.9 then raise exception 'preço deveria gravar'; end if;
  perform public.set_product_price(v_t, '30000000-0000-0000-0000-000000000061', v_ch, 139.9);
  if (select preco from public.product_prices where product_id = '30000000-0000-0000-0000-000000000061' and channel_id = v_ch) <> 139.9 then raise exception 'preço deveria atualizar'; end if;
  perform public.set_product_price(v_t, '30000000-0000-0000-0000-000000000061', v_ch, null);
  if exists (select 1 from public.product_prices where channel_id = v_ch) then raise exception 'preço nulo deveria apagar'; end if;
  begin
    perform public.set_product_price(v_t, '30000000-0000-0000-0000-000000000061', v_ch2, -1);
    raise exception 'preço negativo deveria falhar';
  exception when invalid_parameter_value then null; end;
  begin
    insert into public.product_prices (tenant_id, product_id, channel_id, preco) values (v_t, '30000000-0000-0000-0000-000000000061', v_ch, 1);
    raise exception 'insert direto de preço deveria falhar';
  exception when insufficient_privilege then null; end;
  -- remoção: soft delete + preços limpos; nome pode ser reutilizado
  perform public.remove_channel(v_t, v_ch2);
  if (select deleted_at from public.channels where id = v_ch2) is null then raise exception 'canal deveria ter deleted_at'; end if;
  if exists (select 1 from public.product_prices where channel_id = v_ch2) then raise exception 'preços do canal removido deveriam sumir'; end if;
  if public.upsert_channel(v_t, null, '{"nome":"Shopee"}') = v_ch2 then raise exception 'novo canal com o mesmo nome deveria ser outro id'; end if;
  begin
    perform public.remove_channel(v_t, v_ch2);
    raise exception 'remover de novo deveria falhar';
  exception when invalid_parameter_value then null; end;
end $$;

-- ---------------------------------------------------------------------------
-- Inventário: MP01 bate, MP02 conta 47 (−3), MP03 por peças 2 rolos de 50 m (+100). Fecha só os divergentes.
-- ---------------------------------------------------------------------------
do $$
declare v_t uuid := current_setting('test.tenant_a')::uuid; v_s uuid; v_n int; it public.inventory_items%rowtype;
begin
  v_s := public.open_inventory_session(v_t, '40000000-0000-0000-0000-000000000006', 'contagem mensal');
  perform set_config('test.sess', v_s::text, false);
  if public.open_inventory_session(v_t, '40000000-0000-0000-0000-000000000006', null) <> v_s then raise exception 'abrir de novo no mesmo local devolve a sessão aberta'; end if;
  perform public.save_inventory_item(v_t, v_s, '20000000-0000-0000-0000-000000000061', 100, null, null);
  perform public.save_inventory_item(v_t, v_s, '20000000-0000-0000-0000-000000000062', 40, null, 'errado');
  perform public.save_inventory_item(v_t, v_s, '20000000-0000-0000-0000-000000000062', 47, null, 'recontagem');
  perform public.save_inventory_item(v_t, v_s, '20000000-0000-0000-0000-000000000063', null, '[{"nome":"rolo","medida":50,"qtd":2}]', null);
  if (select count(*) from public.inventory_items where session_id = v_s) <> 3 then raise exception 'recontagem não pode duplicar item'; end if;
  select * into it from public.inventory_items where session_id = v_s and material_id = '20000000-0000-0000-0000-000000000062';
  if it.contado <> 47 or it.saldo_sistema <> 50 or it.motivo <> 'recontagem' then raise exception 'item de MP02 inesperado: %', to_jsonb(it); end if;
  if (select contado from public.inventory_items where session_id = v_s and material_id = '20000000-0000-0000-0000-000000000063') <> 100 then raise exception 'contagem por peças deveria dar 100'; end if;
  begin
    perform public.save_inventory_item(v_t, v_s, '20000000-0000-0000-0000-000000000061', -1, null, null);
    raise exception 'contagem negativa deveria falhar';
  exception when invalid_parameter_value then null; end;
  v_n := public.close_inventory_session(v_t, v_s);
  if v_n <> 2 then raise exception 'deveria gerar 2 ajustes, veio %', v_n; end if;
  if (select status from public.inventory_sessions where id = v_s) <> 'fechada' or (select fechada_em from public.inventory_sessions where id = v_s) is null then raise exception 'sessão deveria fechar'; end if;
  if (select delta from public.stock_moves where idempotency_key = 'inv:' || v_s || ':20000000-0000-0000-0000-000000000062') <> -3 then raise exception 'ajuste de MP02 deveria ser -3'; end if;
  if (select move_type from public.stock_moves where idempotency_key = 'inv:' || v_s || ':20000000-0000-0000-0000-000000000062') <> 'ajuste' then raise exception 'tipo deveria ser ajuste'; end if;
  if (select custo_unit from public.stock_moves where idempotency_key = 'inv:' || v_s || ':20000000-0000-0000-0000-000000000062') <> 1 then raise exception 'ajuste deveria sair ao custo médio'; end if;
  if (select delta from public.stock_moves where idempotency_key = 'inv:' || v_s || ':20000000-0000-0000-0000-000000000063') <> 100 then raise exception 'ajuste de MP03 deveria ser +100'; end if;
  if exists (select 1 from public.stock_moves where idempotency_key = 'inv:' || v_s || ':20000000-0000-0000-0000-000000000061') then raise exception 'MP01 sem divergência não gera ajuste'; end if;
  if (select saldo from public.stock_balances where material_id = '20000000-0000-0000-0000-000000000062') <> 47 then raise exception 'saldo de MP02 deveria ser 47'; end if;
  if (select saldo from public.stock_balances where material_id = '20000000-0000-0000-0000-000000000063') <> 100 then raise exception 'saldo de MP03 deveria ser 100'; end if;
  if (select stock_move_id from public.inventory_items where session_id = v_s and material_id = '20000000-0000-0000-0000-000000000062') is null then raise exception 'item divergente deveria apontar o movimento'; end if;
  if (select stock_move_id from public.inventory_items where session_id = v_s and material_id = '20000000-0000-0000-0000-000000000061') is not null then raise exception 'item sem divergência não tem movimento'; end if;
  -- fechar de novo: 0, sem novos movimentos; salvar depois de fechada falha
  if public.close_inventory_session(v_t, v_s) <> 0 then raise exception 'segundo fechamento deveria devolver 0'; end if;
  if (select count(*) from public.stock_moves where move_type = 'ajuste') <> 2 then raise exception 'segundo fechamento não pode duplicar ajustes'; end if;
  begin
    perform public.save_inventory_item(v_t, v_s, '20000000-0000-0000-0000-000000000061', 1, null, null);
    raise exception 'salvar em sessão fechada deveria falhar';
  exception when invalid_parameter_value then null; end;
  -- aviso do fechamento; membro marca como lido direto, mas não insere
  if (select count(*) from public.notifications where tipo = 'inventario') <> 1 then raise exception 'fechamento deveria gerar aviso'; end if;
  update public.notifications set lida = true where tipo = 'inventario';
  if (select lida from public.notifications where tipo = 'inventario') is not true then raise exception 'aviso deveria ser marcado como lido'; end if;
  begin
    insert into public.notifications (tenant_id, tipo, texto) values (v_t, 'sistema', 'x');
    raise exception 'insert direto de aviso deveria falhar';
  exception when insufficient_privilege then null; end;
  begin
    perform public.notify(v_t, 'sistema', 'x');
    raise exception 'notify não deveria ser chamável pelo cliente';
  exception when insufficient_privilege then null; end;
  -- configuração de avisos: admin grava direto
  insert into public.notification_settings (tenant_id, config) values (v_t, '{"eventos":{"minimo":{"email":true}},"webhooks":[]}');
  if (select config -> 'eventos' -> 'minimo' ->> 'email' from public.notification_settings where tenant_id = v_t) <> 'true' then raise exception 'notification_settings'; end if;
end $$;
select auth.test_logout();

-- Leitura não mexe em canal, preço nem inventário.
select auth.test_login('00000000-0000-0000-0000-00000000006c');
do $$ begin
  begin
    perform public.upsert_channel(current_setting('test.tenant_a')::uuid, null, '{"nome":"X"}');
    raise exception 'leitura não deveria criar canal';
  exception when insufficient_privilege then null; end;
  begin
    perform public.open_inventory_session(current_setting('test.tenant_a')::uuid, '40000000-0000-0000-0000-000000000006', null);
    raise exception 'leitura não deveria abrir inventário';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.channels where deleted_at is null) <> 2 then raise exception 'leitura deveria ver os canais do tenant'; end if;
end $$;
select auth.test_logout();

-- ---------------------------------------------------------------------------
-- Tenant B: canal com o mesmo nome é permitido; não vê nem escreve nada de A.
-- ---------------------------------------------------------------------------
select auth.test_login('00000000-0000-0000-0000-00000000006b');
do $$
declare t text; n bigint; v_ch uuid;
begin
  v_ch := public.upsert_channel(current_setting('test.tenant_b')::uuid, null, '{"nome":"Shopee","comissao_pct":0.2}');
  if (select count(*) from public.channels) <> 1 then raise exception 'tenant B deveria ver só o próprio canal'; end if;
  foreach t in array array['channels', 'product_prices', 'inventory_sessions', 'inventory_items', 'notifications', 'notification_settings'] loop
    execute format('select count(*) from public.%I where tenant_id = $1', t) using current_setting('test.tenant_a')::uuid into n;
    if n <> 0 then raise exception 'tenant B não deveria ver % linhas de %', n, t; end if;
  end loop;
  update public.notifications set lida = false where tenant_id = current_setting('test.tenant_a')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'tenant B alterou avisos de A'; end if;
  begin
    perform public.set_product_price(current_setting('test.tenant_a')::uuid, '30000000-0000-0000-0000-000000000061', current_setting('test.ch')::uuid, 1);
    raise exception 'set_product_price cruzado deveria falhar';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_product_price(current_setting('test.tenant_b')::uuid, '30000000-0000-0000-0000-000000000061', v_ch, 1);
    raise exception 'produto de A no canal de B deveria falhar';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.remove_channel(current_setting('test.tenant_a')::uuid, current_setting('test.ch')::uuid);
    raise exception 'remove_channel cruzado deveria falhar';
  exception when insufficient_privilege then null; end;
  begin
    perform public.close_inventory_session(current_setting('test.tenant_a')::uuid, current_setting('test.sess')::uuid);
    raise exception 'close_inventory_session cruzado deveria falhar';
  exception when insufficient_privilege then null; end;
end $$;
select auth.test_logout();

rollback;
