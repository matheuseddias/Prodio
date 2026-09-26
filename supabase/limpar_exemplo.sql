-- Prodio · remove os dados de exemplo da Eddias e mantém a empresa, usuários, aparelhos e operadores.
-- Use antes de importar os dados reais (a importação do ES recusa gravar enquanto houver exemplo).
-- ATENÇÃO: apaga TUDO do tenant 'eddias' — conectores, pedidos, OCs, NF-e, etiquetas, bipes, ledger e cadastros —,
-- não só o exemplo. Por isso a trava abaixo para o script se encontrar sinal de uso real (inclusive cadastro que
-- não é do exemplo, como o que a importação do ES grava) e mostra as contagens. Com conector ligado ou pedido real, o
-- caminho é limpar_so_exemplo.sql (apaga só o exemplo e mantém a integração e os pedidos); a trava diz isso.
-- Para apagar mesmo assim, ponha esta linha no começo da MESMA execução do SQL Editor:
--   set prodio.limpar_mesmo_assim = 'sim';

-- A trava fica no MESMO bloco da limpeza: se ela disparar, nada é apagado, rode como rodar (SQL Editor ou psql).
do $$
declare
  t uuid;
  v_sinais jsonb;
begin
  select id into t from public.tenants where slug = 'eddias';
  if t is null then raise notice 'empresa eddias não encontrada'; return; end if;

  -- Trava: sinais de uso real (o que o seed não cria).
  select jsonb_strip_nulls(jsonb_build_object(
    'conectores ligados', nullif((select count(*) from public.connectors where tenant_id = t and status <> 'desconectado'), 0),
    'pedidos importados', nullif((select count(*) from public.orders where tenant_id = t and external_id not like 'seed:%'), 0),
    'ordens de compra', nullif((select count(*) from public.purchase_orders where tenant_id = t and id::text not like '0c000000-%'), 0),
    'NF-e', nullif((select count(*) from public.nfe_inbound where tenant_id = t and id::text not like '0e000000-%'), 0),
    'recebimentos', nullif((select count(*) from public.receipts where tenant_id = t and id::text not like '0f000000-%'), 0),
    'inventários', nullif((select count(*) from public.inventory_sessions where tenant_id = t and id::text not like '0b000000-%'), 0),
    -- Cadastro real (à mão ou pela importação do ES): o seed só usa os ids fixos a0…/b0…/c0….
    'produtos fora do exemplo', nullif((select count(*) from public.products where tenant_id = t and id::text not like 'a0000000-0000-0000-0000-%'), 0),
    'insumos fora do exemplo', nullif((select count(*) from public.materials where tenant_id = t and id::text not like 'b0000000-0000-0000-0000-%'), 0),
    'fornecedores fora do exemplo', nullif((select count(*) from public.suppliers where tenant_id = t and id::text not like 'c0000000-0000-0000-0000-%'), 0),
    'etiquetas', nullif((select count(*) from public.labels where tenant_id = t), 0),
    'bipes', nullif((select count(*) from public.scan_events where tenant_id = t), 0),
    'movimentos de estoque', nullif((select count(*) from public.stock_moves where tenant_id = t
        and coalesce(idempotency_key, '') not like 'seed:%'
        and coalesce(ref_id::text, '') not like '0e000000-%' and coalesce(ref_id::text, '') not like '0b000000-%'), 0)))
    into v_sinais;
  -- A mensagem sempre aponta o limpar_so_exemplo.sql (apaga só o exemplo). Com conector ligado ou pedido importado
  -- ela nem oferece a confirmação: forçar aqui apagaria a integração e os pedidos reais.
  if v_sinais <> '{}'::jsonb and coalesce(current_setting('prodio.limpar_mesmo_assim', true), '') <> 'sim' then
    if v_sinais ? 'conectores ligados' or v_sinais ? 'pedidos importados' then
      raise exception 'o Prodio já tem uso real no tenant eddias: %. Este script apagaria tudo isso junto com o exemplo, inclusive a integração e os pedidos; nada foi apagado. Não force este script: rode limpar_so_exemplo.sql, que apaga só o exemplo e mantém conectores, credenciais, o cursor do robô e os pedidos.', v_sinais;
    end if;
    raise exception 'o Prodio já tem uso real no tenant eddias: %. Este script apagaria tudo isso junto com o exemplo; nada foi apagado. Para tirar só o exemplo e manter o resto, rode limpar_so_exemplo.sql. Para apagar tudo mesmo assim, rode antes, na mesma execução: set prodio.limpar_mesmo_assim = ''sim'';', v_sinais;
  end if;

  delete from public.notifications where tenant_id = t;
  delete from public.inventory_items where tenant_id = t;
  delete from public.inventory_sessions where tenant_id = t;
  delete from public.product_prices where tenant_id = t;
  delete from public.channels where tenant_id = t;
  delete from public.integration_outbox where tenant_id = t;
  delete from public.order_items where tenant_id = t;
  delete from public.orders where tenant_id = t;
  delete from public.audit_runs where tenant_id = t;
  delete from public.hub_stock_snapshots where tenant_id = t;
  delete from public.connector_status_map where tenant_id = t;
  delete from public.sync_state where tenant_id = t;
  delete from public.connector_credentials where tenant_id = t;
  delete from public.connectors where tenant_id = t;
  delete from public.receipt_items where tenant_id = t;
  delete from public.receipts where tenant_id = t;
  delete from public.nfe_po_links where tenant_id = t;
  delete from public.nfe_inbound_items where tenant_id = t;
  delete from public.nfe_inbound where tenant_id = t;
  delete from public.purchase_order_items where tenant_id = t;
  delete from public.purchase_orders where tenant_id = t;
  delete from public.scan_events where tenant_id = t;
  delete from public.labels where tenant_id = t;
  delete from public.daily_plans where tenant_id = t;
  delete from public.stock_balances where tenant_id = t;
  alter table public.stock_moves disable trigger user;
  delete from public.stock_moves where tenant_id = t;
  alter table public.stock_moves enable trigger user;
  delete from public.bom_lines where tenant_id = t;
  delete from public.bom_versions where tenant_id = t;
  delete from public.supplier_materials where tenant_id = t;
  delete from public.materials where tenant_id = t;
  delete from public.sku_aliases where tenant_id = t;
  delete from public.products where tenant_id = t;
  delete from public.suppliers where tenant_id = t;
  update public.doc_counters set next_value = 1 where tenant_id = t;
  raise notice 'dados de exemplo removidos; empresa, usuários, locais, unidades, perfis de etiqueta e operadores mantidos';
end $$;
