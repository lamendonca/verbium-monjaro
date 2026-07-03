-- =====================================================================
-- Mounjaro — frequência de recompra calculada pelo histórico.
-- clientes.frequencia vira estimativa inicial OPCIONAL: a partir da 2ª
-- compra, a frequência efetiva é a média dos intervalos entre as datas
-- (distintas) de pedidos do cliente, e prevalece sobre a estimativa.
-- Ver business-rules.md §1. Idempotente.
-- =====================================================================

ALTER TABLE monjaro.clientes ALTER COLUMN frequencia DROP NOT NULL;

-- v_cliente_recompra: frequencia agora é a EFETIVA (calculada ≥ 2 compras,
-- senão a estimativa manual; NULL se nenhuma). Coluna nova: compras.
CREATE OR REPLACE VIEW monjaro.v_cliente_recompra AS
WITH hist AS (
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
SELECT id AS cliente_id, nome, contato,
       COALESCE(
         CASE WHEN compras >= 2
              THEN ROUND((ultimo_pedido - primeiro_pedido)::numeric / (compras - 1))::int
         END,
         freq_manual
       ) AS frequencia,
       ultimo_pedido,
       ultimo_pedido + COALESCE(
         CASE WHEN compras >= 2
              THEN ROUND((ultimo_pedido - primeiro_pedido)::numeric / (compras - 1))::int
         END,
         freq_manual
       ) AS proxima_recompra,
       compras
FROM hist;

GRANT SELECT ON monjaro.v_cliente_recompra TO anon;
