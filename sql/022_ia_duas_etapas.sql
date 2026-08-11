-- =====================================================================
-- 022 — corrige a 019: `reescrever_mensagem_ia()` era uma função só,
-- bloqueada esperando a resposta da LLM (polling com pg_sleep dentro do
-- mesmo statement). Isso sempre estourava o statement_timeout=3s do role
-- `anon` (guarda de segurança do Supabase, aplicada a toda query do app)
-- — e SET LOCAL dentro da função não ajuda: o prazo do statement já está
-- fixado no valor de quando ele começou, mudar no meio não estende.
--
-- Troca por duas funções RPC curtas, com o polling do lado do client:
--   1. iniciar_reescrita_ia()  — dispara o pg_net, devolve o request_id
--      na hora (fire-and-forget, sempre rápido).
--   2. checar_resposta_ia()    — leitura simples de net._http_response;
--      NULL enquanto não chegou. O client chama a cada ~1s até vir texto.
-- Idempotente.
-- =====================================================================

DROP FUNCTION IF EXISTS monjaro.reescrever_mensagem_ia(TEXT, TEXT);

CREATE OR REPLACE FUNCTION monjaro.iniciar_reescrita_ia(p_rascunho TEXT, p_cliente_nome TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = monjaro, net, public
AS $$
DECLARE
  cfg_url   TEXT;
  cfg_token TEXT;
  cfg_model TEXT;
  prompt    TEXT;
  req_id    BIGINT;
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
      'messages', jsonb_build_array(jsonb_build_object('role', 'user', 'content', prompt))),
    timeout_milliseconds := 20000
  ) INTO req_id;

  RETURN req_id;
END;
$$;

GRANT EXECUTE ON FUNCTION monjaro.iniciar_reescrita_ia(TEXT, TEXT) TO anon;

CREATE OR REPLACE FUNCTION monjaro.checar_resposta_ia(p_request_id BIGINT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = monjaro, net, public
AS $$
DECLARE
  v_status  INT;
  v_content TEXT;
  texto     TEXT;
BEGIN
  SELECT status_code, content INTO v_status, v_content
  FROM net._http_response WHERE id = p_request_id;

  IF v_status IS NULL THEN
    RETURN NULL; -- ainda não chegou — client tenta de novo em breve
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

GRANT EXECUTE ON FUNCTION monjaro.checar_resposta_ia(BIGINT) TO anon;
