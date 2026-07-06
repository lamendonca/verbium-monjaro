-- =====================================================================
-- 014 — indicação: cliente indicado por outro cliente
-- FK auto-referente; a cadeia multinível (A→B→C) sai dela sem estrutura
-- extra. Bonificação é decisão manual (regra muda por campanha) — o app
-- só dá visibilidade (seção Indicações do mês, no Financeiro).
-- Idempotente.
-- =====================================================================

ALTER TABLE monjaro.clientes
  ADD COLUMN IF NOT EXISTS indicado_por UUID REFERENCES monjaro.clientes(id);

CREATE INDEX IF NOT EXISTS ix_clientes_indicado_por ON monjaro.clientes(indicado_por);
