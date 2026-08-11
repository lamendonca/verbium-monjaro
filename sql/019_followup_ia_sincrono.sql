-- =====================================================================
-- 019 — corrige o desenho da 018: a intenção real era um botão no modal
-- ("varinha mágica") que o operador aciona NA HORA, reescrevendo o
-- rascunho ali mesmo — não uma reescrita automática em background.
-- Remove o trigger/cron assíncrono da 018 e troca por uma função síncrona
-- (polling curto dentro do próprio statement, via pg_net + pg_sleep) que o
-- client chama diretamente (RPC) e recebe o texto de volta na hora.
-- Idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- remove a automação em background da 018
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_followups_gerar_ia ON monjaro.followups;
DROP FUNCTION IF EXISTS monjaro.trigger_gerar_ia();
DROP FUNCTION IF EXISTS monjaro.gerar_mensagem_ia(UUID);
DROP FUNCTION IF EXISTS monjaro.coletar_respostas_ia();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monjaro_ia_coleta') THEN
    PERFORM cron.unschedule('monjaro_ia_coleta');
  END IF;
END;
$$;

ALTER TABLE monjaro.followups DROP COLUMN IF EXISTS ia_request_id;
ALTER TABLE monjaro.followups DROP COLUMN IF EXISTS mensagem_ia;

-- enviar_followups() volta a usar só fu.mensagem (sem mensagem_ia, que não
-- existe mais — o texto final já está em mensagem quando o operador usa
-- a varinha mágica antes de salvar).
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
      numero := '55' || numero;
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

-- ---------------------------------------------------------------------
-- reescrever_mensagem_ia: chamada DIRETA pelo client (anon) via RPC, no
-- clique da varinha mágica. Síncrona: dispara o pg_net e aguarda a
-- resposta com um polling curto (pg_sleep) dentro do mesmo statement —
-- até ~8s. Nunca guarda nada; só devolve o texto pro modal.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION monjaro.reescrever_mensagem_ia(p_rascunho TEXT, p_cliente_nome TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = monjaro, net, public
AS $$
DECLARE
  cfg_url    TEXT;
  cfg_token  TEXT;
  cfg_model  TEXT;
  prompt     TEXT;
  req_id     BIGINT;
  v_status   INT;
  v_content  TEXT;
  texto      TEXT;
  tentativas INT := 0;
BEGIN
  SELECT valor INTO cfg_url   FROM monjaro.config WHERE chave = 'ai_chat_url';
  SELECT valor INTO cfg_token FROM monjaro.config WHERE chave = 'ai_chat_token';
  SELECT valor INTO cfg_model FROM monjaro.config WHERE chave = 'ai_model';
  IF cfg_url IS NULL OR cfg_token IS NULL OR cfg_model IS NULL THEN
    RAISE EXCEPTION 'ia_nao_configurada';
  END IF;
  IF p_rascunho IS NULL OR length(trim(p_rascunho)) = 0 THEN
    RAISE EXCEPTION 'ia_sem_rascunho';
  END IF;

  prompt := format(
    'Reescreva a mensagem de WhatsApp abaixo pro cliente %s, variando o ' ||
    'texto (não repita literalmente) mas mantendo o mesmo pedido e tom ' ||
    'pessoal e curto. Responda só com o texto final, sem aspas e sem ' ||
    'explicação. Mensagem original: "%s"',
    coalesce(p_cliente_nome, ''), p_rascunho);

  SELECT net.http_post(
    url     := cfg_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || cfg_token),
    body    := jsonb_build_object(
      'model', cfg_model, 'stream', false,
      'messages', jsonb_build_array(jsonb_build_object('role', 'user', 'content', prompt)))
  ) INTO req_id;

  LOOP
    PERFORM pg_sleep(0.4);
    SELECT status_code, content INTO v_status, v_content
    FROM net._http_response WHERE id = req_id;
    tentativas := tentativas + 1;
    EXIT WHEN v_status IS NOT NULL OR tentativas >= 20; -- ~8s de espera máxima
  END LOOP;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'ia_timeout';
  END IF;
  IF v_status != 200 THEN
    RAISE EXCEPTION 'ia_erro_http_%', v_status;
  END IF;

  texto := (v_content::json) -> 'choices' -> 0 -> 'message' ->> 'content';
  IF texto IS NULL OR length(trim(texto)) = 0 THEN
    RAISE EXCEPTION 'ia_resposta_vazia';
  END IF;
  RETURN trim(texto);
END;
$$;

-- Ao contrário das demais funções de IA/envio, esta É chamada direto pelo
-- client (anon) — clique da varinha mágica no modal.
GRANT EXECUTE ON FUNCTION monjaro.reescrever_mensagem_ia(TEXT, TEXT) TO anon;
