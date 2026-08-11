-- =====================================================================
-- 016 — tendência financeira mensal (dashboard do Financeiro).
-- Receita e custo agrupados por mês do pedido, mesma regra de
-- v_lucro_por_lote (só pedido pago conta, custo rateado por qtd *
-- custo_unit do lote vinculado). Lucro é calculado na leitura (JS).
-- Idempotente.
-- =====================================================================

CREATE OR REPLACE VIEW monjaro.v_financeiro_mensal AS
SELECT date_trunc('month', p.data)::date AS mes,
       COALESCE(SUM(p.valor) FILTER (WHERE p.pagamento = 'pago'), 0) AS receita,
       COALESCE(SUM(p.qtd * cp.custo_unit) FILTER (WHERE p.pagamento = 'pago'), 0) AS custo,
       COUNT(*) FILTER (WHERE p.pagamento = 'pago') AS pedidos_pagos
FROM monjaro.pedidos p
LEFT JOIN monjaro.compras cp ON cp.id = p.compra_id
WHERE p.is_active
GROUP BY 1
ORDER BY 1;

GRANT SELECT ON monjaro.v_financeiro_mensal TO anon;
