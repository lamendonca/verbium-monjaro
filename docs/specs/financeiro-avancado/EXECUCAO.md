# Relatório de execução — lançamentos avulsos, dashboard e follow-up IA

Data: 2026-08-11 · Branch: `feat/financeiro-avancado`

## Entregue

| # | Item | Onde |
|---|------|------|
| 1 | Lançamentos avulsos (despesa/receita por cliente), incorporados ao lucro por cliente e ao consolidado | `sql/015` (aplicada), `financeiro.js`, `index.html` |
| 2 | Dashboard: ticket médio, margem %, variação vs. mês anterior, gráfico de tendência (SVG nativo) | `sql/016` (aplicada), `financeiro.js`, `chart.js`, `index.html`, `style.css` |
| 3 | Follow-up com mensagem gerada por IA (trigger + polling via `pg_net`/`pg_cron`), fallback pro template original | `sql/017`/`018` (aplicadas), `index.html` (hint) |
| 4 | Correção de segurança: chave real (`JARBIS`) removida do `.env.example` (estava commitável) | `.env.example` |
| 5 | Docs: `business-rules.md`, `data-model.md` | `.claude/context/*` |

## Verificação executada

1. **Migrations**: `monjaro_015_lancamentos_avulsos`, `monjaro_016_financeiro_mensal`, `monjaro_017_config_ia`, `monjaro_018_followup_ia` aplicadas via MCP no projeto `mendonca` (lfvjefvbxyrzediqcurt) — todas `success: true`.
2. **Feature 1 (lançamentos avulsos)** — testada ponta a ponta com Playwright headless contra o Supabase real (Docker Desktop indisponível no momento):
   - Criar despesa/receita atualiza `fin-lucro` corretamente (−7000 → −7050 → −7020, batendo com −50/−50/+30 lançados).
   - Lista "Lançamentos avulsos" mostra descrição e badges corretos.
   - Card do cliente incorpora o avulso (`avulsos -R$X`) no lucro exibido.
   - Caso de borda: cliente **sem nenhum pedido**, só com avulso, aparece corretamente na lista de lucro por cliente.
   - Zero erros de console.
   - Dados de teste (3 lançamentos) soft-deletados depois — banco de produção não ficou com resíduo visível.
3. **Feature 2 (follow-up IA)**: smoke test via SQL direto —
   - INSERT de teste em `followups` disparou o trigger sem erro; como `monjaro.config` ainda não tem as chaves `ai_chat_*`/`ai_model`, `gerar_mensagem_ia()` retornou cedo (fallback confirmado) — `ia_request_id`/`mensagem_ia` permaneceram `NULL`.
   - `coletar_respostas_ia()` executado manualmente sem erro.
   - Cron jobs `monjaro_followups` e `monjaro_ia_coleta` confirmados ativos em `cron.job`.
   - Registro de teste soft-deletado.
4. **View `v_financeiro_mensal`**: consultada diretamente, retornando receita/custo/pedidos_pagos agrupados por mês corretamente para os dados reais existentes.

## Pendente de validação manual (produção — a pedido do Lucas)

- [ ] Dashboard: layout do gráfico de tendência e dos KPIs novos no navegador real (mobile, iOS Safari).
- [ ] CRUD completo de lançamentos avulsos pela UI real (criar, editar, remover).
- [ ] Follow-up: depois de o Lucas preencher `ai_chat_url`/`ai_chat_token`/`ai_model` em `monjaro.config`, confirmar que a IA gera texto de fato e que o envio (`enviar_followups()`) usa o texto gerado.
- [ ] Confirmar que o `.env` real (fora do git) já tinha o `JARBIS` correto — só o `.env.example` (template) precisou de correção.

## Limitações registradas

- "Taxa de conversão do funil" não foi implementada como KPI — não existe histórico de transição de fase nos dados atuais; documentado como ressalva em `business-rules.md` §4, não prometido no dashboard.
- Nome do modelo de IA em produção (`config.ai_model`) fica como placeholder — o Lucas define e insere manualmente (fora de migration versionada).
- Geração de IA depende inteiramente do polling a cada 10min; um follow-up agendado pra "hoje" (sem a folga padrão de 1 dia) pode não ter uma resposta pronta a tempo do envio das 12h — nesse caso sai o template original, que é o comportamento esperado (fallback), não um bug.
