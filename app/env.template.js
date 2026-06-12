// Template de injeção de env. O entrypoint do nginx roda envsubst sobre este
// arquivo e gera /tmp/env.js (servido como /env.js). NÃO commitar app/env.js.
// config.js lê window.__ENV__.
window.__ENV__ = {
  SUPABASE_URL: "${SUPABASE_URL}",
  SUPABASE_ANON_KEY: "${SUPABASE_ANON_KEY}",
  APP_TOKEN: "${APP_TOKEN}",
  ENV: "${ENV}"
};
