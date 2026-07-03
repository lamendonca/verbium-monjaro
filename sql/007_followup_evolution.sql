-- =====================================================================
-- Monjaro — pilha Follow-up com envio automático via Evolution API.
-- Ao mover um cliente pra Follow-up, o operador escolhe data e mensagem;
-- um job diário (pg_cron) envia as mensagens vencidas via pg_net direto
-- pra instância Evolution e marca enviado_em. Ver business-rules.md §6.
--
-- Credenciais ficam em monjaro.config (RLS deny — anon NÃO lê):
--   evolution_url      ex.: https://evo.meudominio.com
--   evolution_instance ex.: principal
--   evolution_apikey   chave da instância
-- Idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- followups (histórico de follow-ups agendados/enviados)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monjaro.followups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id  UUID NOT NULL REFERENCES monjaro.clientes(id),
  data        DATE NOT NULL,                -- quando enviar
  mensagem    TEXT NOT NULL,
  enviado_em  TIMESTAMPTZ,                  -- NULL = pendente
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_followups_updated ON monjaro.followups;
CREATE TRIGGER trg_followups_updated BEFORE UPDATE ON monjaro.followups
  FOR EACH ROW EXECUTE FUNCTION monjaro.set_updated_at();

CREATE INDEX IF NOT EXISTS ix_followups_cliente   ON monjaro.followups(cliente_id);
CREATE INDEX IF NOT EXISTS ix_followups_pendentes ON monjaro.followups(data) WHERE enviado_em IS NULL AND is_active;

ALTER TABLE monjaro.followups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_all ON monjaro.followups;
CREATE POLICY anon_all ON monjaro.followups
  FOR ALL TO anon USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON monjaro.followups TO anon;

-- ---------------------------------------------------------------------
-- config (credenciais — anon NÃO acessa: RLS deny + revoke)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monjaro.config (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
ALTER TABLE monjaro.config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON monjaro.config FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- envio via Evolution API (pg_net) + agenda diária (pg_cron)
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION monjaro.enviar_followups()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = monjaro, net, public
AS $$
DECLARE
  cfg_url  TEXT;
  cfg_inst TEXT;
  cfg_key  TEXT;
  f        RECORD;
  numero   TEXT;
BEGIN
  SELECT valor INTO cfg_url  FROM monjaro.config WHERE chave = 'evolution_url';
  SELECT valor INTO cfg_inst FROM monjaro.config WHERE chave = 'evolution_instance';
  SELECT valor INTO cfg_key  FROM monjaro.config WHERE chave = 'evolution_apikey';
  IF cfg_url IS NULL OR cfg_inst IS NULL OR cfg_key IS NULL THEN
    RAISE NOTICE 'monjaro.config sem credenciais da Evolution — nada enviado';
    RETURN;
  END IF;

  FOR f IN
    SELECT fu.id, fu.mensagem, cl.contato
    FROM monjaro.followups fu
    JOIN monjaro.clientes cl ON cl.id = fu.cliente_id AND cl.is_active
    WHERE fu.is_active AND fu.enviado_em IS NULL AND fu.data <= CURRENT_DATE
  LOOP
    numero := regexp_replace(f.contato, '\D', '', 'g');
    IF length(numero) <= 11 THEN
      numero := '55' || numero;  -- sem DDI → Brasil
    END IF;
    PERFORM net.http_post(
      url     := cfg_url || '/message/sendText/' || cfg_inst,
      headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', cfg_key),
      body    := jsonb_build_object('number', numero, 'text', f.mensagem)
    );
    -- http_post é assíncrono (fila do pg_net); marcamos como enviado aqui.
    UPDATE monjaro.followups SET enviado_em = NOW() WHERE id = f.id;
  END LOOP;
END;
$$;

-- anon não pode disparar envios
REVOKE EXECUTE ON FUNCTION monjaro.enviar_followups() FROM PUBLIC, anon, authenticated;

-- agenda: todo dia às 12:00 UTC (9h de Brasília)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monjaro_followups') THEN
    PERFORM cron.unschedule('monjaro_followups');
  END IF;
  PERFORM cron.schedule('monjaro_followups', '0 12 * * *', 'SELECT monjaro.enviar_followups()');
END;
$$;
