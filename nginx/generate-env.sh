# Gera /tmp/env.js (servido como /env.js) a partir das variáveis de ambiente.
# Valores passam por escape de \ e " antes de virar string JS — envsubst cru
# quebraria (ou injetaria código) com aspas no token/chave (WR-03 do review).
# Rodado pelo entrypoint oficial do nginx (/docker-entrypoint.d/) no boot.
# Não usar `set -e`/`exit`: o entrypoint dá `source` neste arquivo.
_esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

cat > /tmp/env.js <<ENVJS
// Gerado no boot do container — não editar, não commitar. config.js lê daqui.
window.__ENV__ = {
  SUPABASE_URL: "$(_esc "$SUPABASE_URL")",
  SUPABASE_ANON_KEY: "$(_esc "$SUPABASE_ANON_KEY")",
  APP_TOKEN: "$(_esc "$APP_TOKEN")",
  ENV: "$(_esc "$ENV")"
};
ENVJS

unset -f _esc
