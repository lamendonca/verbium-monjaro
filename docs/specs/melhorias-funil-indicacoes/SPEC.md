# Spec — Melhorias: estorno no kanban, pendente ≠ receita, indicações, bonificados e follow-up

Data: 2026-07-06 · Branch: `feat/implementacao-mvp`

## Contexto

Rodada de melhorias motivada por um bug e pela operação real do funil:

1. **Bug do kanban**: arrastar um card de **Pendente pagamento** de volta para **Follow-up** só agendava a mensagem e deixava o pedido vivo — valor não estornado, estoque baixado.
2. **Pendente contando como receita**: pedido não pago entrava na receita do lucro por lote (e no KPI Lucro) — pendente ainda não é receita.
3. **Indicações (com multinível)**: marcar cliente como indicação de outro e acompanhar por mês as vendas de indicados (diretos e indiretos) — base pra bonificar. **A bonificação é decisão manual do Lucas** (a regra muda por campanha); o app só dá visibilidade.
4. **Pedidos bonificados**: registrar o brinde como pedido `pagamento='bonificado'` — baixa estoque e custo, sem receita nem "a receber".
5. **Lote sem pagamento**: registrar estoque em mãos como lote sem pendência (custo opcional), pra apoiar a expedição.
6. **Follow-up como motor de retomada**: badge ×N de voltas ao Follow-up no ciclo atual; coluna agrupada por data; badge de frequência nos cards; remoção da lista "acionar nos próximos 10 dias" do Início.

## Decisões (do Lucas)

- Pendente → Follow-up: **remove o pedido, com confirmação** (estoque volta ao lote). Pago → Follow-up: idem (confirm avisa que desfaz venda paga). Entregue → Follow-up: só agenda (ciclo concluído).
- Indicação "fechada": **qualquer venda paga de indicado no mês** (recorrência conta), pela `pedidos.data`.
- Multinível: **cadeia no detalhe do cliente + níveis (diretas/indiretas) na seção Indicações** do Financeiro.
- Pedido bonificado: **valor R$ 0 travado**; custo da unidade conta. **Sem regra automática** de bonificação.
- Lote sem pagamento: opção "Sem pagamento" + custo opcional; **custo 0 = só expedição, fora do lucro por lote**.
- Contador de follow-up: **ciclo atual** (desde o último pedido; sem pedido = desde o cadastro).
- Fora do escopo: fórmula do `lucroPorCliente` (bonificado com valor 0 não infla); `valor_pago` de parcial; data de pagamento.

## Implementação

### Migrations (aplicadas no Supabase `mendonca` / lfvjefvbxyrzediqcurt)
- `sql/013_receita_so_pago.sql` — `v_lucro_por_lote`: LEFT JOIN só com `p.pagamento = 'pago'`; `WHERE c.custo_total > 0`.
- `sql/014_cliente_indicacao.sql` — `clientes.indicado_por UUID REFERENCES clientes(id)` + índice.

### `app/js/inicio.js`
- `moverCard` → Follow-up: confirm quando há pedido em aberto (`de ∈ {pendente, pago}`); o pedido é removido (`removerPedido` — soft delete + devolve estoque) **só no save do modal** de follow-up; abandonar o modal não remove nada. Erro do estorno tem toast próprio.
- `quitado(p)` (pago|bonificado) na derivação de fases; card bonificado não entregue cai em **Pago** ("bonificado, separar/entregar").
- Mover bonificado pra **Entregue** não sobrescreve o pagamento (só `entrega`).
- `contarRetomadas`: linhas de `followups` (qualquer `is_active`/`enviado_em`) com `created_at` ≥ data do último pedido → badge **×N** (N ≥ 2) nos cards da coluna Follow-up.
- Coluna Follow-up com subcabeçalhos por data (`Hoje` / `Amanhã` / `Atrasado · dd/mm` / dd/mm).
- Badge "a cada N dias" (frequência efetiva da `v_cliente_recompra`) em todo card com frequência.
- Removidos: lista de alertas do Início (`itemAlerta`, bloco `avisos`, markup `lista-alertas`).

### `app/js/pedidos.js` + `index.html`
- Option **Bonificado** no select de pagamento; selecionar zera e trava o campo valor (grava `valor: 0`).
- Badge `bonificado` (roxo); filtro "Pendentes" agora é `pagamento ∈ {pendente, parcial}`.

### `app/js/compras.js` + `index.html`
- Option **Sem pagamento** (`sem_pagamento`); custo total opcional (vazio → 0, sem `required`).
- Badges: "Sem pagamento" e "sem custo — fora do lucro" (custo 0); sub do card omite custo zerado.

### `app/js/clientes.js` + `index.html`
- Select "Indicado por" no cadastro (clientes ativos, exclui o próprio); `listarClientes()` traz `indicador:indicado_por(nome)` (self-join).
- Badge filtrável "Indicação de X" no card; no detalhe, badge + linha "Indicou: B, C…".

### `app/js/financeiro.js` + `index.html`
- `a_receber` = `pendente|parcial` (bonificado fora).
- Seção **Indicações do mês** (`input type="month"`, default mês corrente): vendas pagas de indicados no mês; o indicador direto credita como **direta** e os acima na cadeia como **indireta** (trava de visitados contra ciclo); badge "bonificado ✓" pra quem já recebeu pedido bonificado no mês.

### Docs
- `business-rules.md` §1/§4/§6, `data-model.md`, `ui.md` e `CLAUDE.md` atualizados.

## Verificação

- SQL: view respondendo pós-013/014 (`lotes_na_view=1`, coluna `indicado_por` presente).
- `docker compose up` + fluxo no navegador e no iOS Safari (checklist no relatório de execução).
