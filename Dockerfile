# Mounjaro — imagem estática auto-contida para deploy (VPS/painel).
# Runtime idêntico ao docker-compose local: nginx:alpine servindo app/ na
# porta 8080, com env.js gerado no boot a partir das variáveis de ambiente
# (SUPABASE_URL, SUPABASE_ANON_KEY, APP_TOKEN, ENV).
FROM nginx:alpine

COPY app /usr/share/nginx/html
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx/generate-env.sh /docker-entrypoint.d/40-generate-env.sh
RUN chmod +x /docker-entrypoint.d/40-generate-env.sh

EXPOSE 8080
