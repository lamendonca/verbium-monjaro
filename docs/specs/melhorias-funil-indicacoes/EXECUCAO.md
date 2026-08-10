# Relatório de execução — melhorias funil/indicações

Data: 2026-07-06 · Branch: `feat/implementacao-mvp`

## Entregue

| # | Item | Onde |
|---|------|------|
| 1 | Pendente/Pago → Follow-up estorna o pedido (confirm; remoção só no save do modal; estoque volta) | `app/js/inicio.js` |
| 2 | Receita do lote só com pedido `pago`; lote `custo_total = 0` fora do lucro | `sql/013_receita_so_pago.sql` (aplicada) |
| 3 | Indicações: `indicado_por` + select no cadastro + badge filtrável + "Indicou:" no detalhe + seção "Indicações do mês" (diretas/indiretas, "bonificado ✓") | `sql/014` (aplicada), `clientes.js`, `financeiro.js`, `index.html` |
| 4 | Pedido bonificado (valor R$ 0 travado, badge, fora de "a receber" e do filtro Pendentes; funil trata como quitado; entregar não sobrescreve) | `pedidos.js`, `financeiro.js`, `clientes.js`, `inicio.js`, `index.html` |
| 5 | Lote sem pagamento (custo opcional → 0; badges "Sem pagamento"/"sem custo") | `compras.js`, `index.html` |
| 6 | Funil: coluna Follow-up agrupada por data (Hoje/Amanhã/Atrasado), badge ×N de retomadas do ciclo, badge "a cada N dias"; lista "acionar nos próximos 10 dias" removida | `inicio.js`, `style.css`, `index.html` |
| 7 | Docs: `business-rules.md`, `data-model.md`, `ui.md`, `CLAUDE.md` | `.claude/context/*` |

## Verificação executada

1. **Migrations**: `monjaro_013_receita_so_pago` e `monjaro_014_cliente_indicacao` aplicadas via MCP no projeto `mendonca` (lfvjefvbxyrzediqcurt) — `success: true`; coluna `indicado_por` confirmada via `information_schema`.
2. **View (SQL, transação com ROLLBACK — zero resíduo)**: lote de R$ 1.000 com 3 pedidos de R$ 500 (pendente, pago, bonificado):
   - `receita = 500.00` (só o pago) ✓ · `lucro = -500.00` ✓
   - lote com `custo_total = 0` ausente da view ✓ · FK `indicado_por` gravando ✓
   - pós-rollback: 0 registros de teste no banco ✓
3. **Sintaxe**: `node --check` OK nos 5 módulos alterados.
4. **App local**: `docker compose up -d --build` → container `Up`; `curl` 200 em `/`, nos 5 JS, `css/style.css` e `env.js`; markup novo presente (`fin-mes-indicacoes`, `cliente-indicado-por`, Bonificado, `sem_pagamento`); `lista-alertas` ausente.

## Pendente de validação manual (iOS Safari — ambiente real)

- [ ] Pendente → Follow-up: confirm → modal → salvar → pedido some, estoque volta, A receber/Lucro atualizam; recusar/abandonar não muda nada.
- [ ] Pago → Follow-up (desfaz venda paga) e Entregue → Follow-up (só agenda).
- [ ] Pedido bonificado: valor travado em 0; card na coluna Pago; Entregue mantém `bonificado`.
- [ ] Lote sem custo: entra no estoque, aceita vínculo, fora do Financeiro.
- [ ] Indicações: cadastro, badges, seção do mês com diretas/indiretas e seletor de mês.
- [ ] Coluna Follow-up: grupos por data e badge ×N após 2 retornos.

## Limitações registradas

- "Venda no mês" usa `pedidos.data` (não existe data de pagamento).
- `lucroPorCliente` inalterado (decisão: bonificados com valor 0 não inflam; revisão fica pra spec futura).
- Bonificação é 100% manual — nenhuma regra automática de campanha no app.
