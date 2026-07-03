-- =====================================================================
-- Mounjaro — valor da última venda por cliente (apoio à negociação).
-- Derivado dos pedidos (nada digitado): v_cliente_recompra ganha a coluna
-- ultimo_valor, com o valor do pedido mais recente do cliente.
-- Idempotente.
-- =====================================================================

CREATE OR REPLACE VIEW monjaro.v_cliente_recompra AS
WITH ult AS (
  SELECT DISTINCT ON (cliente_id) cliente_id, valor
  FROM monjaro.pedidos
  WHERE is_active
  ORDER BY cliente_id, data DESC, created_at DESC
),
hist AS (
  SELECT cl.id, cl.nome, cl.contato, cl.frequencia AS freq_manual,
         COUNT(DISTINCT p.data) AS compras,
         MIN(p.data) AS primeiro_pedido,
         MAX(p.data) AS ultimo_pedido
  FROM monjaro.clientes cl
  LEFT JOIN monjaro.pedidos p
         ON p.cliente_id = cl.id AND p.is_active
  WHERE cl.is_active
  GROUP BY cl.id
)
SELECT h.id AS cliente_id, h.nome, h.contato,
       COALESCE(
         CASE WHEN h.compras >= 2
              THEN ROUND((h.ultimo_pedido - h.primeiro_pedido)::numeric / (h.compras - 1))::int
         END,
         h.freq_manual
       ) AS frequencia,
       h.ultimo_pedido,
       h.ultimo_pedido + COALESCE(
         CASE WHEN h.compras >= 2
              THEN ROUND((h.ultimo_pedido - h.primeiro_pedido)::numeric / (h.compras - 1))::int
         END,
         h.freq_manual
       ) AS proxima_recompra,
       h.compras,
       u.valor AS ultimo_valor
FROM hist h
LEFT JOIN ult u ON u.cliente_id = h.id;

GRANT SELECT ON monjaro.v_cliente_recompra TO anon;
