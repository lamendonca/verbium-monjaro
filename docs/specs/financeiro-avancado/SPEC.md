# Spec — Lançamentos avulsos, dashboard do Financeiro e follow-up com IA

Data: 2026-08-11 · Branch: `feat/financeiro-avancado`

## Contexto

Três lacunas levantadas numa sessão de planejamento, depois da validação do deploy anterior:

1. **Lançamentos avulsos**: despesas ou receitas soltas ligadas a um cliente (reembolso, taxa extra) não tinham onde entrar — ficavam fora do lucro por cliente e do consolidado.
2. **Follow-up repetitivo**: a mensagem agendada no funil era sempre o mesmo template fixo.
3. **Dashboard do Financeiro "pobre"**: só 4 números + 3 listas simples, sem KPIs derivados nem tendência ao longo do tempo.

## Decisões (do Lucas)

- Lançamentos avulsos: tabela única com campo `tipo` (não duas tabelas); entram no lucro por cliente e no consolidado (incorporados ao número exibido, não separados); cadastrados na tela Financeiro; editáveis livremente (CRUD completo).
- Geração de mensagem por IA: **100% dentro do Postgres** (trigger + `pg_net` + `pg_cron` polling) — sem Edge Function, sem infra nova. O rascunho do operador no modal vira **contexto do prompt**, não é descartado.
- Gráfico de tendência: SVG nativo (sem lib nova), escopo "mais completo" — barras de receita + linha de lucro no mesmo gráfico.
- Fora do escopo: taxa de conversão real do funil (não existe histórico de transição de fase — dashboard usa só aproximações onde fizer sentido, sem prometer métrica que os dados não sustentam); nome definitivo do modelo de IA em produção (fica placeholder em `config.ai_model`, o Lucas preenche depois).

## Implementação

### Migrations (aplicadas no Supabase `mendonca` / lfvjefvbxyrzediqcurt)
- `sql/015_lancamentos_avulsos.sql` — tabela `monjaro.lancamentos` (cliente_id, tipo, valor, descricao, data) + RLS/índices.
- `sql/016_financeiro_mensal.sql` — view `v_financeiro_mensal` (receita/custo/pedidos_pagos por mês, mesma regra de `v_lucro_por_lote`).
- `sql/017_config_ia.sql` — documentação das chaves `ai_chat_url`/`ai_chat_token`/`ai_model` em `monjaro.config` (sem INSERT de valor real).
- `sql/018_followup_ia.sql` — colunas `followups.ia_request_id`/`mensagem_ia`; funções `gerar_mensagem_ia`, `trigger_gerar_ia` (trigger AFTER INSERT), `coletar_respostas_ia` (cron `monjaro_ia_coleta`, */10min); `enviar_followups()` atualizada com `COALESCE(mensagem_ia, mensagem)`.

### `app/js/financeiro.js`
- `listarLancamentos`, `salvarLancamento`, `lancamentosPorCliente`, `lucroPorClienteComAvulsos` (mescla na camada de tela, sem alterar `lucroPorCliente`), `cardLancamento`.
- `consolidado()`: soma lançamentos ao `lucro_total`.
- `tendenciaMensal()`, `kpisAvancados()` (ticket médio, margem %, variação vs. mês anterior).
- `initFinanceiro()`: CRUD de lançamentos (modal), popula KPIs novos e renderiza o gráfico.

### `app/js/chart.js` (novo)
- `graficoTendencia(pontos)` — SVG nativo via `createElementNS` (não `el()` de `ui.js`, que usa `createElement` e não serve pra tags SVG). Barras de receita + linha de lucro, sem dependência externa.

### `app/index.html`
- Seção "Lançamentos avulsos" (Financeiro) + modal `modal-lancamento`.
- Segunda `summary-grid` (ticket médio, margem, variação) + container do gráfico.
- Hint do modal de follow-up avisando que a IA pode reescrever o texto.

### `app/css/style.css`
- `.chart-wrap`, `.chart-legenda`, `.chart-swatch`, `.kpi-delta.up/.down`.

### Docs
- `business-rules.md` §4 (lançamentos avulsos, KPIs do dashboard, ressalva de taxa de conversão) e §6 (fluxo de IA no follow-up); `data-model.md` (tabela `lancamentos`, view `v_financeiro_mensal`, colunas de IA em `followups`/`config`).

## Verificação

- SQL: todas as 4 migrations aplicadas via MCP (`success: true`); colunas/view/cron confirmados via `information_schema`/`cron.job`.
- App: testado com Playwright headless (servidor estático local, já que o Docker Desktop estava fora do ar) — Feature 1 (lançamentos) validada ponta a ponta contra o Supabase real, incluindo o caso de cliente só com avulso (sem pedido). Dados de teste soft-deletados depois.
- Feature 3 (dashboard) e Feature 2 (follow-up IA): sem teste automatizado de UI nesta rodada — validação em produção, a pedido do Lucas.
