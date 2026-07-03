# Decisões registradas (ADRs) — Mounjaro

Decisões tomadas no planejamento (chat-export). Cada uma vale até nova decisão registrada aqui. Convergidas a partir do framework herdado; onde diferem, prevalecem.

Data base: 2026-06-12

---

## ADR-001 — Construir como app web próprio (não Notion/Sheets/Airtable)

**Contexto**: o operador cogitou Notion, Google Sheets e Airtable.
**Decisão**: construir um app web próprio ("pelo Claude mesmo"), porque dá controle total sobre os cálculos (lucro por lote/cliente, alertas) e a experiência mobile.
**Consequência**: precisamos de banco, hospedagem e auth próprios — resolvidos pelos ADRs abaixo.

---

## ADR-002 — Stack: HTML/CSS/JS vanilla + Supabase

**Decisão**: frontend em HTML/CSS/JS **vanilla** (sem framework, sem build), banco no **Supabase (Postgres)** schema `monjaro`, acesso direto via `@supabase/supabase-js`.
**Por quê**: app de 3 tabelas, single-user, mobile-first. Framework JS/bundler seria peso sem ganho. Supabase entrega Postgres + API (PostgREST) sem manter backend.
**Diverge do framework herdado** (Python/FastAPI/SQL Server): registrado em `framework.md`. O `CLAUDE.md` do Mounjaro prevalece.

---

## ADR-003 — Sem Supabase Auth; acesso por `APP_TOKEN`

**Decisão**: login direto por um token único (`APP_TOKEN` no `.env`), comparado de forma constante; **não** usar Supabase Auth.
**Por quê**: é uso exclusivo do operador — não há contas, papéis nem multi-tenant. Token único é suficiente e simples.
**Implicação de segurança**: o token e a `anon key` chegam ao browser (app estático). A defesa real dos dados é **RLS** no schema `monjaro`. Detalhe e modelo de ameaça em `security.md`.

---

## ADR-004 — Cadastro mínimo de cliente; acionamento por frequência em dias

**Decisão**: cliente guarda só `nome`, `contato`, `frequencia` (dias) e `dose` opcional. O acionamento é calculado pela **frequência em dias**, não por dose/apresentação.
**Por quê**: o operador não sabe/não quer mapear doses por apresentação; o sinal útil é "quando esse cliente costuma recomprar".
**Antecedência do alerta**: fixa em **10 dias**. Regra em `business-rules.md`.

---

## ADR-005 — Produto único: 1 unidade de 4ml

**Decisão**: tratar tudo como "1 unidade" (caneta de 4ml). Sem catálogo de apresentações/doses estruturadas.
**Por quê**: simplifica estoque e financeiro — `qtd` em unidades resolve. `dose` fica como texto livre opcional, sem efeito em cálculo.

---

## ADR-006 — Estoque é o lote; baixa por vínculo pedido→compra

**Decisão**: não há tabela de estoque separada. Cada `compra` (lote) carrega `qtd_disp`, decrementado ao vincular pedidos. Lucro é apurado **por lote** e **por cliente**, cruzando compra×venda.
**Por quê**: o operador quer "avaliar o lucro por lote de compra e por cliente". Modelar estoque como propriedade do lote entrega isso com 3 tabelas. Regras em `business-rules.md`.

---

## ADR-007 — Soft delete em tudo

**Decisão**: nenhuma exclusão física. "Excluir" = `is_active = false`.
**Por quê**: histórico de vendas/compras é a base do financeiro — apagar fisicamente destruiria os relatórios. Herdado do framework `[orig]`, mantido.

---

## ADR-008 — Docker + Nginx (mantém o lote viável de infra do framework)

**Decisão**: empacotar em Docker Compose, servido por **Nginx** (estático + injeção de env). Sem backend próprio.
**Por quê**: o operador pediu para usar Docker ("vamos usar o docker tb"). Nginx serve o `app/` e injeta `window.__ENV__` a partir do `.env`. Detalhe em `architecture.md` e `operations.md`.

---

## ADR-009 — Mobile first, dark mode roxo

**Decisão**: UI desenhada para celular, dark mode por padrão, paleta roxa (`--primary: #6C63FF`). Bottom-nav com 5 abas. Sem light mode no MVP.
**Por quê**: o operador acessa "pelo celular, sempre". Tokens e componentes em `brand.md`; telas em `ui.md`.

---

## ADR-010 — `.env` para credenciais; nunca hardcoded

**Decisão**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `APP_TOKEN`, `ENV` vivem no `.env` (gitignored). `.env.example` commitado. Browser recebe via injeção do nginx (`env.js`, também gitignored).
**Por quê**: herdado do framework `[orig]`. Único módulo que lê env é `config.js`.

---

## ADR-011 — RLS: policies abertas para `anon` (MVP consciente)

**Data**: 2026-07-03
**Contexto**: RLS estava em default deny (ADR-003 delega a defesa dos dados à RLS). Era preciso escolher entre Edge Function + `service_role` (recomendação do `security.md`) e o gate simples.
**Decisão**: caminho simples do MVP — policies `anon_all` (`USING (true)`) nas 3 tabelas, via `sql/002_rls_policies_anon.sql`, aplicada no projeto `mendonca`.
**Mitigações**: GRANT ao `anon` só de `SELECT/INSERT/UPDATE` — **sem DELETE**, o que torna o soft delete garantia física no banco; acesso ao app segue atrás do `APP_TOKEN` + URL não pública.
**Risco aceito**: quem obtiver a anon key lê/escreve os dados (PII de clientes). Aceito temporariamente pelo operador para destravar o uso.
**Revisão**: migrar para Edge Function + `service_role` antes de expor o app publicamente ou se houver qualquer sinal de acesso indevido (monitorar logs no dashboard).

---

## ADR-012 — Dois temas: claro padrão + dark Dracula (revisa ADR-009)

**Data**: 2026-07-03
**Contexto**: o operador achou o dark original (quase-preto azulado) escuro demais.
**Decisão**: tema **claro como padrão** + tema **escuro estilo Dracula** (suave), alternados por toggle no header. Tokens por tema em `html[data-theme]`; escolha persistida em `localStorage['monjaro.theme']` e aplicada antes do primeiro paint. Texto sobre o primário usa `--on-primary` (o roxo Dracula é claro). Badges derivam fundo via `color-mix` para valerem nos dois temas.
**Revisa**: ADR-009 ("dark por padrão, sem light mode no MVP") — mantém mobile-first e o roxo como cor de marca.

---

## ADR-013 — Frequência de recompra calculada pelo histórico (revisa ADR-004)

**Data**: 2026-07-03
**Contexto**: o cadastro exigia `frequencia` manual, mas o operador quer que a agenda de acionamento nasça do comportamento real do cliente.
**Decisão**: `clientes.frequencia` vira **estimativa inicial opcional** (nullable, migration `004`). A partir da **2ª compra**, a frequência efetiva é a média dos intervalos entre as datas distintas de pedidos — `(MAX(data) − MIN(data)) / (compras − 1)` — calculada na view `v_cliente_recompra`, e **prevalece** sobre a estimativa.
**Novos estados**: cliente com 1 compra e sem estimativa fica `sem_padrao` ("Aguardando 2ª compra") e não entra na agenda do Início.
**Revisa**: ADR-004 (frequência manual obrigatória). Mantém a antecedência fixa de 10 dias.

---

## Pendências / decisões adiadas

- **Pagamento parcial com valor**: hoje `parcial` conta como "a receber" inteiro. Se precisar do valor pago exato, adicionar `valor_pago` em migration `002`. Não implementar antes de pedido.
- **Antecedência configurável** do alerta (hoje fixa em 10 dias): só parametrizar se o operador pedir.
- **Baixa de estoque atômica**: se a corrida client-side virar problema, mover decremento para função RPC no Postgres.
- **Hospedagem de produção** (Vercel/VPS/etc.) e TLS: decidir no deploy. Ver `operations.md`.
- **Backup**: confiar no backup gerenciado do Supabase (plano) — confirmar política antes de produção.
