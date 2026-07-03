-- =====================================================================
-- Mounjaro — retomada manual de negociação no funil.
-- negociacao_em marca quando o operador puxou o cliente de volta para
-- "Não iniciada" (arrasto no kanban). Um pedido posterior encerra a
-- negociação (derivado, sem write extra). Ver business-rules.md §6.
-- Idempotente.
-- =====================================================================

ALTER TABLE monjaro.clientes ADD COLUMN IF NOT EXISTS negociacao_em DATE;
