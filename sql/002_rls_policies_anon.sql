-- =====================================================================
-- Monjaro — policies RLS para o role anon (estratégia simples do MVP).
-- Decisão registrada em .claude/context/decisions.md (ADR: RLS anon gate).
-- O acesso ao app é protegido pelo APP_TOKEN + URL não pública; quem tiver
-- a anon key acessa os dados — aceito conscientemente para o MVP.
-- Migração futura recomendada: Edge Function + service_role (security.md §1).
-- Idempotente.
-- =====================================================================

GRANT USAGE ON SCHEMA monjaro TO anon;

-- Sem GRANT de DELETE: soft delete vira garantia no banco, não só convenção.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA monjaro TO anon;

-- Views de leitura (financeiro / recompra)
GRANT SELECT ON monjaro.v_lucro_por_lote, monjaro.v_cliente_recompra TO anon;

DROP POLICY IF EXISTS anon_all ON monjaro.clientes;
CREATE POLICY anon_all ON monjaro.clientes
  FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS anon_all ON monjaro.compras;
CREATE POLICY anon_all ON monjaro.compras
  FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS anon_all ON monjaro.pedidos;
CREATE POLICY anon_all ON monjaro.pedidos
  FOR ALL TO anon USING (true) WITH CHECK (true);
