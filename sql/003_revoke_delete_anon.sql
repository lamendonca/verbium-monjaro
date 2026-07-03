-- =====================================================================
-- Monjaro — revogar DELETE/TRUNCATE do anon (correção da 002).
-- O Supabase aplica default privileges com GRANT ALL ao anon em tabelas
-- novas; o GRANT seletivo da 002 não remove isso — precisa de REVOKE.
-- Sem DELETE, o soft delete (is_active=false) vira garantia física.
-- Idempotente.
-- =====================================================================

REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA monjaro FROM anon;

-- Tabelas futuras do schema nascem sem DELETE/TRUNCATE para o anon.
ALTER DEFAULT PRIVILEGES IN SCHEMA monjaro
  REVOKE DELETE, TRUNCATE ON TABLES FROM anon;
