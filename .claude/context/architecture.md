# Arquitetura — Mounjaro

App pessoal mobile-first. Não há backend próprio: o browser fala direto com o Supabase. O nginx só serve os arquivos estáticos e injeta a configuração de ambiente. Tudo roda num container.

## Topologia

```
        ┌─────────────────────────────────────────┐
        │  Celular do operador (navegador)         │
        │  app/index.html + css + js (ES modules)  │
        │           │                               │
        │           ▼                               │
        │   app/js/db.js  ──(@supabase/supabase-js)─┼───────────┐
        └───────────────────────────────────────────┘           │
                    ▲ HTTP (estático + window.__ENV__)           │ HTTPS (REST/PostgREST)
                    │                                            ▼
        ┌───────────┴───────────────┐         ┌──────────────────────────────┐
        │   nginx (container Docker) │         │  Supabase (Postgres)         │
        │   serve app/ + injeta env  │         │  schema: monjaro             │
        │   porta 8080→80            │         │  tabelas: clientes,          │
        └────────────────────────────┘         │           compras, pedidos   │
                                               └──────────────────────────────┘
```

## Princípios

- **Sem backend próprio.** O Supabase (PostgREST) é a API. O JS do browser consulta/escreve direto, via `app/js/db.js`.
- **Schema dedicado.** Tudo vive em `monjaro.*`, não em `public`. O client é configurado com `db: { schema: 'monjaro' }`.
- **Estado só no Supabase.** O container não tem volume persistente. Perdeu o host? `docker compose up -d` em outro e tudo volta.
- **`app/js/db.js` é o único ponto de acesso ao banco** — equivalente ao `shared/db.py` do framework herdado. Centraliza o client e as queries reutilizáveis.
- **Coordenação por dados, não por serviços.** É um app de página única; não há filas, workers, nem múltiplos serviços. A complexidade do projeto original (4 serviços + queue table) **não se aplica**.

## Componentes

### nginx (container `web`)
- Imagem `nginx:alpine`.
- Serve `app/` como estático em `:80` (mapeado para `:8080` no host).
- **Injeta env**: na subida, gera `app/env.js` (ou um trecho `window.__ENV__`) com `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `APP_TOKEN`, a partir das variáveis do `.env`. Ver "Injeção de env" abaixo.
- Hardening: `cap_drop:[ALL]`, `no-new-privileges`, `read_only` + `tmpfs`. Ver `docker-compose.yml` e `security.md`.
- Em produção: TLS (cert no proxy ou no próprio nginx). MVP local: HTTP.

### Frontend (`app/`)
- `index.html` — shell único: header, páginas (Início/Clientes/Pedidos/Lotes/Financeiro), bottom-nav, modais. Páginas alternam via `.page.active` (sem router). Ver `ui.md`.
- `css/style.css` — design tokens + componentes. Ver `brand.md`.
- `js/` — ES modules, sem bundler:
  - `config.js` — lê `window.__ENV__` e exporta `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `APP_TOKEN`, `ENV`.
  - `db.js` — instancia o client (única porta). Pode expor helpers (`list`, `insert`, `update`, `softDelete`).
  - `auth.js` — tela de login; compara o token digitado com `APP_TOKEN`; guarda flag de sessão em `localStorage`.
  - `clientes.js`, `pedidos.js`, `compras.js`, `financeiro.js` — um por domínio. Importam `db.js`.

### Supabase
- Projeto Postgres gerenciado. Schema `monjaro` com 3 tabelas (ver `data-model.md`).
- A `anon key` é exposta no browser (inevitável num app estático). A proteção real é **RLS** no schema + o `APP_TOKEN` como porta de entrada do app. Ver `security.md` para o modelo de ameaça e as policies.

## Injeção de env (browser não lê `.env`)

O `.env` existe só no host/container — o browser nunca o acessa. Fluxo:

1. `docker-compose.yml` passa as variáveis via `env_file: .env`.
2. No boot do container, um entrypoint do nginx gera um arquivo servido ao browser, por exemplo `app/env.js`:
   ```js
   window.__ENV__ = {
     SUPABASE_URL: "https://xxxx.supabase.co",
     SUPABASE_ANON_KEY: "...",
     APP_TOKEN: "...",
     ENV: "production"
   };
   ```
   gerado com `envsubst` a partir de um template `app/env.template.js`.
3. `index.html` carrega `env.js` **antes** dos módulos.
4. `config.js` lê `window.__ENV__` e re-exporta.

> ⚠️ `APP_TOKEN` e `anon key` chegam ao browser — é esperado para app estático single-user. Não trate o `APP_TOKEN` como segredo forte de servidor; ele é um portão de conveniência. A defesa de dados é a RLS no Supabase (ver `security.md`). `env.js` é gerado em runtime e **gitignored** — nunca commitar.

## Fluxos principais

```
Login:        usuário digita token → auth.js compara com APP_TOKEN → libera shell
Carregar:     página ativa → módulo.list() → db.from('tabela').select() → render
Criar/editar: modal → módulo.save() → db.insert/update → recarrega lista
"Excluir":    módulo.softDelete() → update is_active=false (nunca DELETE)
Pedido↔lote:  pedidos.js vincula compra_id e decrementa compras.qtd_disp
Alertas:      Início calcula recompra a partir de clientes.frequencia + último pedido
```

## Onde NÃO crescer agora

- Não adicionar backend/serviço próprio — PostgREST do Supabase basta.
- Não adicionar framework JS, bundler ou router — 5 páginas em 1 arquivo não justificam.
- Não adicionar fila/worker/cron — o app é acionado pelo uso, não por agenda.
- Não adicionar Supabase Auth/multi-tenant — é single-user por decisão (ver `decisions.md`).
