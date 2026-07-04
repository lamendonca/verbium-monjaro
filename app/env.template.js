// Referência do formato do /env.js gerado em runtime pelo nginx
// (nginx/generate-env.sh — heredoc com escaping; NÃO usa mais envsubst).
// NÃO commitar app/env.js. config.js lê window.__ENV__.
window.__ENV__ = {
  SUPABASE_URL: "${SUPABASE_URL}",
  SUPABASE_ANON_KEY: "${SUPABASE_ANON_KEY}",
  APP_TOKEN: "${APP_TOKEN}",
  ENV: "${ENV}"
};
