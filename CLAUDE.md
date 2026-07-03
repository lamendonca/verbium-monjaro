# CLAUDE.md — Monjaro

Aplicação pessoal de gestão de vendas de Monjaro. Controla clientes, pedidos, lotes de compra, estoque e financeiro, com alertas de recompra. Uso exclusivo do operador — **sem multi-tenant, sem Supabase Auth**.

> **Leia este arquivo antes de qualquer tarefa.** Ele é a fonte da verdade do projeto e prevalece sobre o framework herdado em `.claude/context/framework.md`. Detalhes em `.claude/context/*`.

## Contexto

- **Quem usa**: o próprio operador, pelo **celular**, sempre. Mobile first não é preferência — é requisito.
- **Domínio**: revende Monjaro para amigos. Vende ~50 unidades por ciclo; precisa comprar ≥ 20 por lote para a compra ser viável.
- **O que controla**: clientes (nome, contato, frequência de recompra em dias), pedidos, compras ao fornecedor (lotes), estoque por lote e financeiro (lucro por lote e por cliente).
- **O que NÃO faz**: não é multi-usuário, não cadastra dose por apresentação (produto único — 1 unidade de 4ml), não envia mensagens automáticas (só gera o alerta e abre o WhatsApp).

## Stack

| Camada       | Tecnologia                                            |
|--------------|-------------------------------------------------------|
| Frontend     | HTML + CSS + JS **vanilla** (sem framework, sem build) |
| Banco        | **Supabase (Postgres)** — schema `monjaro`            |
| Acesso ao DB | `@supabase/supabase-js` via ESM CDN, **só** em `app/js/db.js` |
| Auth         | Token único `APP_TOKEN` no `.env` — **sem** Supabase Auth |
| Container    | Docker + Docker Compose                               |
| Servidor     | Nginx (serve estático + injeta config + proxy)        |
| Credenciais  | `.env` gitignored — `.env.example` commitado          |

Por que essa stack: ver `.claude/context/decisions.md`. Por que **não** Python/SQL Server/FastAPI (a stack do framework herdado): é um app pessoal de 3 tabelas, mobile-first — a simplicidade de HTML/JS + Supabase ganha. As adaptações estão registradas em `.claude/context/framework.md`.

## Regras do projeto (prevalecem sobre o framework herdado)

- Stack é **HTML/CSS/JS vanilla** — não é Python/FastAPI.
- Banco é **Supabase (Postgres)**, schema `monjaro` — não é SQL Server.
- `app/js/db.js` é a **ÚNICA porta** para o Supabase (equivalente ao `shared/db.py` do framework). Nenhum outro módulo instancia o client.
- **Sem Supabase Auth** — acesso via `APP_TOKEN` comparado de forma constante (sem `===` ingênuo; ver `security.md`).
- **Soft delete** em todas as tabelas operacionais (`is_active = true/false`). **Nunca `DELETE` físico.**
- Migrations numeradas em `sql/NNN_descricao.sql`, sequenciais, idempotentes (`IF NOT EXISTS`).
- `.env` sempre gitignored; `.env.example` sempre commitado.
- Toda variável de ambiente é lida só por `app/js/config.js` — os demais módulos importam de lá.

## Estrutura de arquivos

```
monjaro/
├── CLAUDE.md                   # este arquivo — auto-load, ler primeiro
├── .env                        # secrets — gitignored SEMPRE
├── .env.example                # template sem valores — commitado SEMPRE
├── .gitignore
├── docker-compose.yml
├── nginx/
│   └── nginx.conf
├── sql/
│   ├── 001_schema.sql          # schema monjaro + tabelas + índices + views
│   └── 002_<descricao>.sql     # migrations subsequentes
└── app/
    ├── index.html              # app de 1 arquivo: shell + páginas + modais
    ├── css/
    │   └── style.css           # design tokens + componentes (ver brand.md)
    └── js/
        ├── config.js           # lê env injetada pelo nginx (window.__ENV__)
        ├── db.js               # ÚNICA porta pro Supabase
        ├── auth.js             # login via APP_TOKEN
        ├── clientes.js         # CRUD + alertas de recompra
        ├── pedidos.js          # CRUD + vínculo a lote + baixa de estoque
        ├── compras.js          # CRUD de lotes + estoque disponível
        └── financeiro.js       # lucro por lote e por cliente
```

## Schema — `monjaro.*` (resumo; fonte da verdade: `data-model.md` + `sql/001_schema.sql`)

- `clientes` — `nome`, `contato` (WhatsApp), `frequencia` (dias entre recompras), `dose` (opcional, texto livre).
- `compras` — lotes do fornecedor: `qtd`, `qtd_disp` (decrementa a cada pedido), `custo_total`, `custo_unit`, `pagamento`, `chegada`, `referencia`.
- `pedidos` — venda: FK `cliente_id`, FK `compra_id` (lote de baixa, nullable), `valor`, `pagamento`, `entrega`.

Todas com `id UUID`, `is_active BOOLEAN`, `created_at`, `updated_at`.

## Regras de negócio (detalhe em `business-rules.md`)

| Regra | Detalhe |
|-------|---------|
| Lote mínimo | Alertar se compra `qtd < 20`. |
| Alerta de recompra | Avisar **10 dias** antes de `ultimo_pedido + frequencia` dias. |
| Status do alerta | `atrasado` (passou da data) · `alerta` (≤ 10 dias) · `ok` (> 10 dias). |
| Estoque | `compras.qtd_disp` decrementa ao vincular um pedido ao lote. |
| Lucro por lote | receita dos pedidos vinculados − custo do lote. |
| Lucro por cliente | receita recebida − custo estimado via lote vinculado. |
| Soft delete | `is_active = false` — nunca DELETE físico. |

## Interface (detalhe em `ui.md` + `brand.md`)

- **Mobile first**, **dark mode** padrão (paleta roxa — ver `brand.md`).
- **Bottom navigation** com 5 abas: **Início · Clientes · Pedidos · Lotes · Financeiro**.
- Modais slide-up para cadastro/edição.
- Botão de WhatsApp direto no card do cliente e nos alertas.
- Início (dashboard) mostra os alertas de recompra dos próximos 10 dias.

## Diretivas para o Claude

### Sempre
- Ler este `CLAUDE.md` antes de qualquer tarefa.
- Usar `app/js/db.js` — nunca instanciar o client do Supabase em outro lugar.
- Ler env só via `app/js/config.js` — nunca hardcodar URL/chave/token.
- Verificar se uma migration já existe antes de criar nova; numerar sequencialmente.
- Commits semânticos (Conventional Commits), um por unidade lógica.
- Atualizar a seção **Estado atual** ao concluir uma feature.

### Nunca (sem aprovação explícita)
- Adicionar dependência nova (qualquer lib JS além do supabase-js) sem discutir.
- Alterar o schema sem criar migration numerada.
- Fazer `DELETE` físico em tabelas operacionais.
- Commitar `.env` ou qualquer arquivo com credencial.
- Push direto em `main`.
- Criar arquivo `.md` não solicitado.
- Adicionar feature ou refatorar além do escopo da tarefa.

### Ao encontrar ambiguidade
Perguntar **uma vez** com as opções mapeadas — não implementar suposição.

## Decisões recorrentes (não perguntar de novo)

| Decisão | Resposta padrão |
|---------|-----------------|
| ORM ou queries diretas? | Supabase JS client via `app/js/db.js` — sem ORM. |
| Autenticação? | `APP_TOKEN` no `.env` — sem Supabase Auth. |
| Banco? | Supabase (Postgres), schema `monjaro`. |
| Docker? | Docker Compose sempre. |
| Deletar registro? | Nunca — soft delete `is_active = false`. |
| Frontend SPA pesada? | Não — HTML/JS vanilla, 1 `index.html`. |
| Comentários no código? | Apenas o **porquê**, nunca o **quê**. |

## Estado atual

### Specs (concluído nesta convergência)
- [x] CLAUDE.md convergido do chat-export para o Monjaro
- [x] `.claude/context/*` reescrito para o Monjaro (framework, architecture, data-model, brand, ui, business-rules, decisions, operations, security, workflow)
- [x] Esqueleto de pastas + `.env.example` + `.gitignore` + `docker-compose.yml` + `nginx/nginx.conf`
- [x] `sql/001_schema.sql` (clientes, compras, pedidos + índices + views)
- [x] Stubs de `app/` (index.html, css/style.css, js/* com docblocks de spec)

### Implementação
- [x] `app/js/config.js` + injeção de env pelo nginx
- [x] `app/js/db.js` (porta única Supabase + helpers list/insert/update/softDelete)
- [x] `app/js/auth.js` (login por APP_TOKEN — digest SHA-256, comparação constante)
- [x] `app/index.html` + `app/css/style.css` (shell mobile, bottom-nav, dark)
- [x] Tela Início (dashboard de alertas + KPIs) — `app/js/inicio.js`
- [x] Tela Clientes (CRUD + WhatsApp + status de recompra)
- [x] Tela Pedidos (CRUD + vínculo a lote + baixa/devolução de estoque)
- [x] Tela Lotes/Compras (CRUD + estoque disponível + aviso lote < 20)
- [x] Tela Financeiro (lucro por lote e por cliente + consolidado)
- [x] `docker compose up` validado servindo o app (nginx não-root, porta 8080 interna)
- [ ] Schema aplicado no Supabase real (aguarda confirmação do projeto alvo)
- [ ] Policies RLS definidas (estratégia em `security.md`) — sem elas o app não lê/escreve
- [ ] Expor schema `monjaro` na API (Dashboard → Settings → API → Exposed schemas)
- [ ] `.env` com credenciais reais (hoje tem placeholders locais)

> Estrutura: além dos módulos spec'ados existem `app/js/ui.js` (helpers de
> apresentação compartilhados) e `app/js/inicio.js` (dashboard — compõe
> clientes/compras/financeiro, conforme mapa tela→módulo do `ui.md`).

## Para aprofundar

- **Framework de desenvolvimento** (princípios, regras, diretivas): `.claude/context/framework.md`
- **Arquitetura** (topologia browser→Supabase, nginx, Docker): `.claude/context/architecture.md`
- **Modelo de dados** (schema, índices, decisões por tabela): `.claude/context/data-model.md`
- **Regras de negócio** (alertas, estoque, lucro): `.claude/context/business-rules.md`
- **Interface** (telas, navegação, fluxos): `.claude/context/ui.md`
- **Design system** (paleta, tipografia, componentes, tom de voz): `.claude/context/brand.md`
- **Decisões registradas** (ADRs): `.claude/context/decisions.md`
- **Operação** (Supabase, docker, nginx, deploy): `.claude/context/operations.md`
- **Segurança** (APP_TOKEN, .env, Supabase, exposição da anon key): `.claude/context/security.md`
- **Workflow** (branches, commits, merges): `.claude/context/workflow.md`
- **Variáveis de ambiente**: `.env.example`
- **Schema SQL**: `sql/001_schema.sql`
