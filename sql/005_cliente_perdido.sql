-- =====================================================================
-- Mounjaro — status "perdido" no funil (cliente recusou a recompra).
-- perdido_em marca a data da recusa: o card fica na coluna Perdido por
-- alguns dias (constante na app) e o cliente sai dos alertas até um novo
-- pedido ou retomada manual. Ver business-rules.md §6. Idempotente.
-- =====================================================================

ALTER TABLE monjaro.clientes ADD COLUMN IF NOT EXISTS perdido_em DATE;
