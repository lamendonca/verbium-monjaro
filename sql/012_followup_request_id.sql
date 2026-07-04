-- =====================================================================
-- Mounjaro — auditoria do envio de follow-ups (WR-02 do review).
-- net.http_post é assíncrono: a resposta da Evolution não é conhecida no
-- momento do envio. Passamos a guardar o request_id retornado pelo pg_net
-- em followups.request_id — com ele dá pra investigar falhas em
-- net._http_response enquanto a fila retém o registro.
-- Limitação documentada: enviado_em segue marcado de forma otimista no
-- despacho; um followup com falha HTTP não é reenviado automaticamente.
-- Idempotente.
-- =====================================================================

ALTER TABLE monjaro.followups ADD COLUMN IF NOT EXISTS request_id BIGINT;

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
  req_id   BIGINT;
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
    SELECT net.http_post(
      url     := cfg_url || '/message/sendText/' || cfg_inst,
      headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', cfg_key),
      body    := jsonb_build_object('number', numero, 'text', f.mensagem)
    ) INTO req_id;
    UPDATE monjaro.followups
    SET enviado_em = NOW(), request_id = req_id
    WHERE id = f.id;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION monjaro.enviar_followups() FROM PUBLIC, anon, authenticated;
