-- =====================================================================
-- Monjaro — origem do cliente (maysa | lucas) e anotação livre.
-- Origem validada na aplicação (TEXT, como os demais domínios de valor).
-- Idempotente.
-- =====================================================================

ALTER TABLE monjaro.clientes ADD COLUMN IF NOT EXISTS origem TEXT;
ALTER TABLE monjaro.clientes ADD COLUMN IF NOT EXISTS anotacao TEXT;
