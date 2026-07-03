-- =====================================================================
-- Mounjaro — schema inicial
-- Aplicar no Supabase (SQL Editor) ou via MCP apply_migration.
-- Idempotente (IF NOT EXISTS / CREATE OR REPLACE). Fonte: data-model.md.
-- Lembre de expor o schema `monjaro` na API: Settings → API → Exposed schemas.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS monjaro;

-- ---------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION monjaro.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- clientes
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monjaro.clientes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL,
  contato     TEXT NOT NULL,                 -- WhatsApp
  frequencia  INT  NOT NULL,                 -- dias entre recompras
  dose        TEXT,                          -- opcional, texto livre
  is_active   BOOLEAN NOT NULL DEFAULT true, -- soft delete
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- compras (lotes do fornecedor — também é o estoque)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monjaro.compras (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data        DATE NOT NULL,
  qtd         INT  NOT NULL,                 -- total comprado (alertar se < 20)
  qtd_disp    INT  NOT NULL,                 -- disponível; decrementa por pedido
  custo_total NUMERIC(10,2) NOT NULL,
  custo_unit  NUMERIC(10,2) NOT NULL,        -- custo_total / qtd (calculado na app)
  pagamento   TEXT NOT NULL DEFAULT 'pendente', -- pendente | parcial | pago
  chegada     DATE,
  referencia  TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT compras_qtd_disp_range CHECK (qtd_disp >= 0 AND qtd_disp <= qtd)
);

-- ---------------------------------------------------------------------
-- pedidos (vendas)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monjaro.pedidos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id  UUID NOT NULL REFERENCES monjaro.clientes(id),
  compra_id   UUID REFERENCES monjaro.compras(id),  -- lote de baixa (nullable)
  data        DATE NOT NULL,
  dose        TEXT,
  qtd         INT  NOT NULL DEFAULT 1,
  valor       NUMERIC(10,2) NOT NULL,
  pagamento   TEXT NOT NULL DEFAULT 'pendente',  -- pendente | parcial | pago
  entrega     TEXT NOT NULL DEFAULT 'aguardando',-- aguardando | separado | entregue
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- triggers updated_at
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_clientes_updated ON monjaro.clientes;
CREATE TRIGGER trg_clientes_updated BEFORE UPDATE ON monjaro.clientes
  FOR EACH ROW EXECUTE FUNCTION monjaro.set_updated_at();

DROP TRIGGER IF EXISTS trg_compras_updated ON monjaro.compras;
CREATE TRIGGER trg_compras_updated BEFORE UPDATE ON monjaro.compras
  FOR EACH ROW EXECUTE FUNCTION monjaro.set_updated_at();

DROP TRIGGER IF EXISTS trg_pedidos_updated ON monjaro.pedidos;
CREATE TRIGGER trg_pedidos_updated BEFORE UPDATE ON monjaro.pedidos
  FOR EACH ROW EXECUTE FUNCTION monjaro.set_updated_at();

-- ---------------------------------------------------------------------
-- índices
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_pedidos_cliente ON monjaro.pedidos(cliente_id);
CREATE INDEX IF NOT EXISTS ix_pedidos_compra  ON monjaro.pedidos(compra_id);
CREATE INDEX IF NOT EXISTS ix_pedidos_data    ON monjaro.pedidos(data DESC);
CREATE INDEX IF NOT EXISTS ix_clientes_ativos ON monjaro.clientes(is_active);
CREATE INDEX IF NOT EXISTS ix_compras_ativos  ON monjaro.compras(is_active);

-- ---------------------------------------------------------------------
-- views (ver business-rules.md)
-- ---------------------------------------------------------------------

-- Lucro por lote: receita dos pedidos vinculados - custo do lote
CREATE OR REPLACE VIEW monjaro.v_lucro_por_lote AS
SELECT c.id AS compra_id, c.referencia, c.qtd, c.qtd_disp,
       c.custo_total,
       COALESCE(SUM(p.valor), 0) AS receita,
       COALESCE(SUM(p.valor), 0) - c.custo_total AS lucro
FROM monjaro.compras c
LEFT JOIN monjaro.pedidos p
       ON p.compra_id = c.id AND p.is_active
WHERE c.is_active
GROUP BY c.id;

-- Recompra por cliente: base do alerta (status calculado na app)
CREATE OR REPLACE VIEW monjaro.v_cliente_recompra AS
SELECT cl.id AS cliente_id, cl.nome, cl.contato, cl.frequencia,
       MAX(p.data) AS ultimo_pedido,
       MAX(p.data) + cl.frequencia AS proxima_recompra
FROM monjaro.clientes cl
LEFT JOIN monjaro.pedidos p
       ON p.cliente_id = cl.id AND p.is_active
WHERE cl.is_active
GROUP BY cl.id;

-- ---------------------------------------------------------------------
-- RLS — ligada por padrão (default deny).
-- Sem policies, ninguém acessa via anon key. Definir a estratégia de
-- acesso ANTES de colocar dados reais (Edge Function + service_role
-- recomendado). Ver security.md. NÃO deixar RLS aberta em produção.
-- ---------------------------------------------------------------------
ALTER TABLE monjaro.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE monjaro.compras  ENABLE ROW LEVEL SECURITY;
ALTER TABLE monjaro.pedidos  ENABLE ROW LEVEL SECURITY;

-- Policies: adicionar conforme a estratégia escolhida (ver security.md).
-- Exemplo (NÃO habilitar sem decisão — libera geral para anon):
--   CREATE POLICY anon_all ON monjaro.clientes FOR ALL TO anon USING (true) WITH CHECK (true);
