-- =====================================================================
-- 015 — lançamentos avulsos: despesa/receita solta ligada a um cliente
-- (ex.: reembolso, taxa extra) que não passa por pedido nem lote. Sempre
-- vinculada a um cliente — sem lançamento "geral" sem dono. O sinal vem
-- do `tipo`, não do `valor` (valor sempre positivo), pra não haver
-- ambiguidade entre "despesa negativa" e "receita".
-- Idempotente.
-- =====================================================================

CREATE TABLE IF NOT EXISTS monjaro.lancamentos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id  UUID NOT NULL REFERENCES monjaro.clientes(id),
  tipo        TEXT NOT NULL,                   -- receita | despesa
  valor       NUMERIC(10,2) NOT NULL,
  descricao   TEXT,
  data        DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lancamentos_tipo_check CHECK (tipo IN ('receita', 'despesa')),
  CONSTRAINT lancamentos_valor_positivo CHECK (valor > 0)
);

DROP TRIGGER IF EXISTS trg_lancamentos_updated ON monjaro.lancamentos;
CREATE TRIGGER trg_lancamentos_updated BEFORE UPDATE ON monjaro.lancamentos
  FOR EACH ROW EXECUTE FUNCTION monjaro.set_updated_at();

CREATE INDEX IF NOT EXISTS ix_lancamentos_cliente ON monjaro.lancamentos(cliente_id);
CREATE INDEX IF NOT EXISTS ix_lancamentos_data    ON monjaro.lancamentos(data DESC);
CREATE INDEX IF NOT EXISTS ix_lancamentos_ativos  ON monjaro.lancamentos(is_active);

-- RLS — mesma estratégia anon-gate das demais tabelas (002/003).
ALTER TABLE monjaro.lancamentos ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON monjaro.lancamentos TO anon;
REVOKE DELETE, TRUNCATE ON monjaro.lancamentos FROM anon;

DROP POLICY IF EXISTS anon_all ON monjaro.lancamentos;
CREATE POLICY anon_all ON monjaro.lancamentos
  FOR ALL TO anon USING (true) WITH CHECK (true);
