-- =====================================================================
-- 013 — receita do lote só conta pedido pago; lote sem custo fora do lucro
-- Pendente/parcial ainda não é receita (aparece só no "a receber");
-- bonificado (valor 0, brinde) nunca é receita. Lote com custo_total = 0
-- é estoque em mãos (expedição) — fora do lucro pra não inflar resultado.
-- Idempotente (CREATE OR REPLACE).
-- =====================================================================

CREATE OR REPLACE VIEW monjaro.v_lucro_por_lote AS
SELECT c.id AS compra_id, c.referencia, c.qtd, c.qtd_disp,
       c.custo_total,
       COALESCE(SUM(p.valor), 0) AS receita,
       COALESCE(SUM(p.valor), 0) - c.custo_total AS lucro
FROM monjaro.compras c
LEFT JOIN monjaro.pedidos p
       ON p.compra_id = c.id AND p.is_active AND p.pagamento = 'pago'
WHERE c.is_active AND c.custo_total > 0
GROUP BY c.id;
