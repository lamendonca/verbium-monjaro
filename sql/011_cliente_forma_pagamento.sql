-- =====================================================================
-- Mounjaro — forma de pagamento preferida do cliente (pix | cartao).
-- Registrada no perfil para apoiar a negociação. Validada na aplicação.
-- Idempotente.
-- =====================================================================

ALTER TABLE monjaro.clientes ADD COLUMN IF NOT EXISTS forma_pagamento TEXT;
