-- =====================================================================
-- 018 — mensagem de follow-up gerada por IA, pra variar o texto sem
-- repetir sempre o mesmo template. 100% dentro do Postgres (pg_net +
-- pg_cron), sem infra nova — mesmo padrão do envio via Evolution (007).
--
-- pg_net é assíncrono (a resposta não existe no mesmo statement da
-- chamada): um trigger AFTER INSERT dispara a geração ao agendar o
-- follow-up; um cron a cada 10min recolhe a resposta pronta em
-- net._http_response e grava followups.mensagem_ia. enviar_followups()
-- usa COALESCE(mensagem_ia, mensagem) — se a IA não respondeu a tempo
-- ou falhou, sai o template original. NUNCA mensagem vazia.
--
-- O rascunho do operador (followups.mensagem) vira contexto/instrução
-- pro prompt — não é descartado quando a IA reescreve.
-- Idempotente.
-- =====================================================================

ALTER TABLE monjaro.followups ADD COLUMN IF NOT EXISTS ia_request_id BIGINT;
ALTER TABLE monjaro.followups ADD COLUMN IF NOT EXISTS mensagem_ia TEXT;

-- ---------------------------------------------------------------------
-- gerar_mensagem_ia: dispara a chamada à API de IA (fire-and-forget).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION monjaro.gerar_mensagem_ia(p_followup_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = monjaro, net, public
AS $$
DECLARE
  cfg_url    TEXT;
  cfg_token  TEXT;
  cfg_model  TEXT;
  v_mensagem TEXT;
  v_nome     TEXT;
  prompt     TEXT;
  req_id     BIGINT;
BEGIN
  SELECT valor INTO cfg_url   FROM monjaro.config WHERE chave = 'ai_chat_url';
  SELECT valor INTO cfg_token FROM monjaro.config WHERE chave = 'ai_chat_token';
  SELECT valor INTO cfg_model FROM monjaro.config WHERE chave = 'ai_model';
  IF cfg_url IS NULL OR cfg_token IS NULL OR cfg_model IS NULL THEN
    RETURN; -- sem config de IA — followup segue com o template (fallback)
  END IF;

  SELECT fu.mensagem, cl.nome INTO v_mensagem, v_nome
  FROM monjaro.followups fu
  JOIN monjaro.clientes cl ON cl.id = fu.cliente_id
  WHERE fu.id = p_followup_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  prompt := format(
    'Reescreva a mensagem de WhatsApp abaixo pro cliente %s, variando o ' ||
    'texto (não repita literalmente) mas mantendo o mesmo pedido e tom ' ||
    'pessoal e curto. Responda só com o texto final, sem aspas e sem ' ||
    'explicação. Mensagem original: "%s"',
    v_nome, v_mensagem);

  SELECT net.http_post(
    url     := cfg_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || cfg_token),
    body    := jsonb_build_object(
      'model', cfg_model, 'stream', false,
      'messages', jsonb_build_array(jsonb_build_object('role', 'user', 'content', prompt)))
  ) INTO req_id;

  UPDATE monjaro.followups SET ia_request_id = req_id WHERE id = p_followup_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION monjaro.gerar_mensagem_ia(UUID) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- trigger: ao agendar um follow-up (client insere), dispara a geração.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION monjaro.trigger_gerar_ia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = monjaro, net, public
AS $$
BEGIN
  IF NEW.enviado_em IS NULL THEN
    PERFORM monjaro.gerar_mensagem_ia(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_followups_gerar_ia ON monjaro.followups;
CREATE TRIGGER trg_followups_gerar_ia AFTER INSERT ON monjaro.followups
  FOR EACH ROW EXECUTE FUNCTION monjaro.trigger_gerar_ia();

-- ---------------------------------------------------------------------
-- coletar_respostas_ia: recolhe a resposta assíncrona (polling).
-- Janela de 2 dias — depois disso desiste e o followup segue com o
-- template original quando enviar_followups() rodar.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION monjaro.coletar_respostas_ia()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = monjaro, net, public
AS $$
DECLARE
  f        RECORD;
  v_status INT;
  v_content TEXT;
  texto    TEXT;
BEGIN
  FOR f IN
    SELECT id, ia_request_id
    FROM monjaro.followups
    WHERE is_active AND ia_request_id IS NOT NULL AND mensagem_ia IS NULL
      AND enviado_em IS NULL AND created_at > NOW() - INTERVAL '2 days'
  LOOP
    SELECT status_code, content INTO v_status, v_content
    FROM net._http_response WHERE id = f.ia_request_id;

    IF v_status = 200 AND v_content IS NOT NULL THEN
      texto := NULL;
      BEGIN
        texto := (v_content::json) -> 'choices' -> 0 -> 'message' ->> 'content';
      EXCEPTION WHEN OTHERS THEN
        texto := NULL; -- resposta em formato inesperado — mantém o fallback
      END;
      IF texto IS NOT NULL AND length(trim(texto)) > 0 THEN
        UPDATE monjaro.followups SET mensagem_ia = trim(texto) WHERE id = f.id;
      END IF;
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION monjaro.coletar_respostas_ia() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monjaro_ia_coleta') THEN
    PERFORM cron.unschedule('monjaro_ia_coleta');
  END IF;
  PERFORM cron.schedule('monjaro_ia_coleta', '*/10 * * * *', 'SELECT monjaro.coletar_respostas_ia()');
END;
$$;

-- ---------------------------------------------------------------------
-- enviar_followups(): passa a preferir o texto da IA, com fallback pro
-- template original — nunca mensagem vazia.
-- ---------------------------------------------------------------------
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
    SELECT fu.id, COALESCE(fu.mensagem_ia, fu.mensagem) AS mensagem, cl.contato
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
