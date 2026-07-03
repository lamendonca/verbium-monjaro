-- =====================================================================
-- Mounjaro — valor da negociação em andamento (digitado pelo operador no
-- detalhe do cliente). Diferente de ultimo_valor (derivado dos pedidos):
-- aqui é o preço sendo conversado com o cliente agora. Idempotente.
-- =====================================================================

ALTER TABLE monjaro.clientes ADD COLUMN IF NOT EXISTS valor_negociacao NUMERIC(10,2);
