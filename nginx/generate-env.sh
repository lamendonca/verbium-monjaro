# Gera /tmp/env.js a partir de app/env.template.js, substituindo as variáveis
# de ambiente (SUPABASE_URL, SUPABASE_ANON_KEY, APP_TOKEN, ENV).
# Rodado pelo entrypoint oficial do nginx (/docker-entrypoint.d/) no boot.
# Não usar `set -e`/`exit`: o entrypoint dá `source` neste arquivo.
envsubst < /usr/share/nginx/html/env.template.js > /tmp/env.js
