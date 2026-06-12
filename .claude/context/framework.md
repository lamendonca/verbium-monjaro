# Framework de desenvolvimento — Monjaro

Derivado de um framework interno de outro projeto (varredura de TI em Python/SQL Server). As adaptações abaixo **prevalecem** sobre aquele framework original. Em caso de conflito, o `CLAUDE.md` do Monjaro tem a palavra final.

> Marcador `[orig]` = princípio herdado mantido. As tabelas "original → Monjaro" mostram o que foi adaptado.

---

## 1. Filosofia

| Princípio | Aplicação no Monjaro |
|---|---|
| **Simples funciona** `[orig]` | HTML/CSS/JS vanilla — sem framework JS, sem bundler, sem transpilador no MVP. |
| **Previsível > esperto** `[orig]` | Sem abstrações desnecessárias. Código legível por quem não é especialista em JS moderno. |
| **Segurança by default** `[orig]` | `APP_TOKEN` nunca hardcoded, nunca logado. `anon key` do Supabase tratada como pública mas protegida por RLS (ver `security.md`). |
| **Sem magia** `[orig]` | Sem metaprogramação, sem build step oculto. O que acontece é visível no `index.html` e nos módulos `js/`. |
| **Auditável** `[orig]` | Operações de pedido/pagamento/estoque carregam `created_at`/`updated_at`. Nada é deletado fisicamente. |

---

## 2. Stack

| Camada | Framework original | Monjaro (adaptado) |
|---|---|---|
| Linguagem | Python 3.12 | **JS vanilla (ES modules)** |
| API/Backend | FastAPI + uvicorn | **Supabase JS client direto** (sem backend próprio) |
| Banco | SQL Server + pyodbc | **Supabase (Postgres)**, schema `monjaro` |
| Porta do DB | `shared/db.py` | **`app/js/db.js`** |
| UI | Jinja2 + htmx | **HTML + CSS + JS vanilla** (1 `index.html`) |
| Containers | Docker + Compose | **Docker + Compose** ✅ mantido |
| Servidor | uvicorn | **Nginx** (estático + injeção de env + proxy) |
| Auth | Bearer `API_TOKEN` | **`APP_TOKEN` local** (sem Supabase Auth) |
| CI/lint/testes Python | ruff/bandit/pytest | **fora do escopo do MVP** — sem toolchain Python |

---

## 3. Estrutura de projeto

```
monjaro/
├── CLAUDE.md                   # contexto do projeto — ler antes de qualquer tarefa
├── .env                        # secrets — gitignored SEMPRE
├── .env.example                # template sem valores — commitado SEMPRE
├── .gitignore
├── docker-compose.yml
├── nginx/
│   └── nginx.conf
├── sql/
│   ├── 001_schema.sql          # schema inicial
│   └── 002_<descricao>.sql     # migrations subsequentes
└── app/
    ├── index.html
    ├── css/
    │   └── style.css
    └── js/
        ├── config.js           # lê variáveis de ambiente injetadas
        ├── db.js               # ÚNICA porta para o Supabase
        ├── auth.js
        ├── clientes.js
        ├── pedidos.js
        ├── compras.js
        └── financeiro.js
```

**Regras estruturais:**
- `app/js/db.js` é o único ponto que instancia o client do Supabase.
- `app/js/config.js` é o único ponto que lê variáveis de ambiente.
- Cada domínio de negócio (clientes, pedidos, compras, financeiro) em seu módulo.
- Migrations em `sql/NNN_descricao.sql` — numeração sequencial, nunca pular número.

---

## 4. Variáveis de ambiente

### Regras obrigatórias `[orig]`
1. Toda credencial/configuração vive exclusivamente no `.env` — nunca hardcoded, nunca em log.
2. `.env` é sempre gitignored — conferir `.gitignore` antes do primeiro commit.
3. `.env.example` é sempre commitado, com as chaves nomeadas e sem valores.
4. `app/js/config.js` é o único módulo que lê env — os demais importam de `config.js`.

### Como a env chega no browser
O browser não lê `.env` diretamente. O `nginx` injeta as variáveis necessárias em `window.__ENV__` no boot (via template / página servida), e `config.js` lê de lá. Ver `architecture.md` (seção "Injeção de env") e `operations.md`.

### `.env.example`
```dotenv
# === Supabase ===
SUPABASE_URL=
SUPABASE_ANON_KEY=

# === Auth ===
APP_TOKEN=                      # gerar com: openssl rand -hex 32

# === Ambiente ===
ENV=development                 # development | production
```

### Variáveis proibidas em log `[orig]`
Nunca logar (nem no console do browser em produção): `*_TOKEN`, `*_KEY`, `*_SECRET`, `*_PASSWORD`.

---

## 5. Banco de dados

### Porta única `[orig]`
`app/js/db.js` é a ÚNICA porta para o Supabase. Nenhum outro módulo instancia o client.

```js
// app/js/db.js — padrão de referência
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js'

export const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'monjaro' },
})
```

### Convenções SQL
```sql
-- snake_case, schema monjaro
CREATE TABLE IF NOT EXISTS monjaro.clientes (...);

-- PKs sempre UUID
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

-- Soft delete — nunca DELETE físico [orig]
is_active BOOLEAN NOT NULL DEFAULT true,

-- Timestamps obrigatórios [orig]
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

### Migrations `[orig]`
- Arquivo: `sql/NNN_descricao_curta.sql`.
- Idempotentes: `IF NOT EXISTS`.
- Nunca dropar coluna sem migration de preservação antes.
- Numeração sequencial — nunca pular número, nunca editar migration já aplicada.

---

## 6. Segurança `[orig]` (detalhe em `security.md`)

```
✅ .env gitignored + .env.example commitado
✅ APP_TOKEN nunca hardcoded, nunca logado
✅ Comparação de token em tempo constante (sem === ingênuo)
✅ anon key do Supabase protegida por RLS no schema monjaro
✅ Container: usuário não-root, cap_drop:[ALL], no-new-privileges
✅ nginx read-only + tmpfs; TLS em produção
```

---

## 7. Docker `[orig]`

`docker-compose.yml` padrão — só o nginx servindo o `app/`:
```yaml
services:
  web:
    image: nginx:alpine
    env_file: .env
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    read_only: true
    tmpfs: [/tmp, /var/cache/nginx, /var/run]
    ports: ["8080:80"]
    restart: unless-stopped
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "5" }
```
(Versão completa em `docker-compose.yml`; detalhes em `operations.md`.)

---

## 8. Git `[orig]`

### Branches
| Prefixo | Quando usar |
|---|---|
| `feat/` | Nova funcionalidade |
| `fix/` | Correção de bug |
| `chore/` | Docs, refactor, deps |
| `security/` | Correção de segurança |

Slug kebab-case, 4–5 palavras. Detalhe em `workflow.md`.

### Commits (Conventional Commits)
```
feat(clientes): adiciona cadastro e histórico
fix(estoque): corrige decremento de qtd_disp ao salvar pedido
chore(deps): atualiza supabase-js
security(auth): adiciona comparação constante de token
```
Sem emoji. Sem co-author Claude (salvo pedido explícito).

---

## 9. Diretivas para o Claude

### Sempre
- Ler o `CLAUDE.md` antes de qualquer tarefa.
- Criar branch `feat/<slug>` antes de implementar feature relevante.
- Usar `app/js/db.js` — nunca instanciar o Supabase client direto.
- Carregar variáveis só via `config.js` — nunca hardcodar.
- Commits semânticos, um por unidade lógica.
- Atualizar `Estado atual` no `CLAUDE.md` ao concluir feature.
- Verificar se a migration SQL já existe antes de criar nova.

### Nunca (sem aprovação explícita)
- Adicionar dependência nova sem discutir.
- Alterar schema SQL sem criar migration numerada.
- Fazer `DELETE` físico em tabelas operacionais.
- Commitar `.env` ou qualquer arquivo com credencial.
- Push direto em `main`.
- Criar arquivo `.md` não solicitado.
- Refatorar/adicionar feature além do escopo da tarefa.

### Ao encontrar ambiguidade
Perguntar **uma vez** com as opções mapeadas — não implementar suposição.

---

## 10. Decisões recorrentes

| Decisão | Resposta padrão Monjaro |
|---|---|
| ORM ou queries diretas? | Supabase JS client via `app/js/db.js` — sem ORM. |
| Autenticação? | `APP_TOKEN` no `.env` — sem Supabase Auth. |
| Banco? | Supabase (Postgres) — schema `monjaro`. |
| Docker? | Docker Compose sempre. |
| Deletar registro? | Nunca — soft delete `is_active = false`. |
| Frontend SPA pesada? | Não — HTML/JS vanilla no MVP. |
| Comentários no código? | Apenas o **porquê** — nunca o **quê**. |
