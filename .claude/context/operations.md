# Operação — Mounjaro

Setup do Supabase, configuração de `.env`, build/run com Docker, deploy e troubleshooting. Estado vive **só** no Supabase — o container é descartável.

## Pré-requisitos

- Docker 24+ e Docker Compose v2 (para rodar local/produção em container).
- Conta no **Supabase** com um projeto criado.
- (Opcional dev) Navegador moderno — o app são ES modules servidos por qualquer estático.

## 1. Supabase: projeto e schema

1. Criar projeto no Supabase (anotar a região).
2. Em **Project Settings → API**, copiar:
   - **Project URL** → `SUPABASE_URL`
   - **anon public key** → `SUPABASE_ANON_KEY`
3. Aplicar o schema: abrir **SQL Editor** e rodar `sql/001_schema.sql` (cria `monjaro`, tabelas, índices, views, trigger e RLS).
   - Migrations seguintes (`sql/002_*.sql`) são rodadas na ordem.
4. **Expor o schema `monjaro` na API**: em **Project Settings → API → Exposed schemas**, adicionar `monjaro` (sem isso o PostgREST não enxerga as tabelas).
5. Conferir **RLS** ativo nas tabelas e as policies do `001_schema.sql` (ver `security.md`).

> Alternativa via MCP do Supabase (quando disponível nesta sessão): `apply_migration` com o conteúdo de `001_schema.sql`. Preferir SQL Editor se não houver MCP autenticado.

## 2. Configurar `.env`

```bash
cp .env.example .env
# editar com valores reais do Supabase + gerar o APP_TOKEN
```

Gerar o token de acesso:
```bash
openssl rand -hex 32      # cola em APP_TOKEN
```

`.env` resultante (exemplo de chaves — nunca commitar valores):
```dotenv
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
APP_TOKEN=<hex de 64 chars>
ENV=development
```

**Nunca commitar `.env`.** O `.gitignore` já cobre — conferir antes do primeiro `git add`.

## 3. Injeção de env no browser

O browser não lê `.env`. O nginx gera, na subida, um `app/env.js` com `window.__ENV__` a partir das variáveis do `.env` (via `envsubst` sobre `app/env.template.js`). `config.js` lê de `window.__ENV__`. Detalhe em `architecture.md` → "Injeção de env".

- `app/env.template.js` (commitado) — template com placeholders.
- `app/env.js` (gerado em runtime) — **gitignored**, nunca commitar (contém token/anon key).

## 4. Subir o app

```bash
docker compose up -d
docker compose logs -f web
# abrir http://localhost:8080
```

No celular (mesma rede), acessar `http://<ip-do-host>:8080`.

## 5. Deploy de produção (resumo)

- Servir atrás de TLS (proxy ou nginx com cert). `ENV=production`.
- Restringir acesso (token + RLS já cobrem o básico; considerar rede privada/HTTPS obrigatório).
- Como não há backend, qualquer host de estáticos + injeção de env serve. Container nginx é o caminho padrão aqui.

## Rotação de credenciais

### `APP_TOKEN`
- Gerar novo: `openssl rand -hex 32`.
- Atualizar `.env` → `docker compose up -d --force-recreate web` (regenera `env.js`).
- O operador precisa digitar o novo token no próximo login.

### `SUPABASE_ANON_KEY`
- Só muda se rotacionar as chaves do projeto no Supabase. Atualizar `.env` e recriar o container.
- Se suspeitar de abuso, rotacionar a chave no Supabase e revisar as RLS policies.

## Backup

- Estado vive **só** no Supabase. Backup é responsabilidade do plano Supabase (point-in-time recovery nos planos pagos; export manual no free).
- Recomendação: export periódico do schema `monjaro` (pg_dump via connection string, ou Dashboard) antes de migrations grandes.
- Perda do host do container = `docker compose up -d` em outro host com o mesmo `.env`; nada se perde (dados estão no Supabase).

## Troubleshooting

### App carrega mas não lê/escreve nada
- `window.__ENV__` populado? Conferir `app/env.js` gerado (no container) e o `<script src="env.js">` antes dos módulos.
- Schema `monjaro` exposto na API do Supabase? (passo 1.4) — sem isso, PostgREST retorna 404/`PGRST106`.
- Client configurado com `db: { schema: 'monjaro' }` em `db.js`?

### Erro 401/permission denied nas queries
- RLS bloqueando: revisar policies do `001_schema.sql` (ver `security.md`). A `anon key` precisa de policy que permita as operações do app.

### Login não passa
- `APP_TOKEN` no `env.js` bate com o digitado? Conferir geração do `env.js` e o `.env`.

### Container não sobe / nginx erro
```bash
docker compose logs web | tail -50
```
- Erro de `envsubst`/entrypoint: conferir `app/env.template.js` e as variáveis no `.env`.
- Permissão (`read_only`): caminhos graváveis precisam de `tmpfs` (`/tmp`, `/var/cache/nginx`, `/var/run`) — ver `docker-compose.yml`.

### Pausar / retomar
```bash
docker compose stop      # estado fica no Supabase
docker compose start
```

### Zerar (apenas dev)
- No SQL Editor do Supabase: `DROP SCHEMA monjaro CASCADE;` e rodar `001_schema.sql` de novo. **Nunca em produção.**

## Atualização (upgrade do app)

```bash
git pull
docker compose up -d --build
```
Schema só muda via migrations: aplicar `sql/00N_*.sql` novas no SQL Editor (ou MCP) na ordem.
