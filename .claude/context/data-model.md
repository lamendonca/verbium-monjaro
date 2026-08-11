# Modelo de dados — Mounjaro

Schema `monjaro` no Supabase (Postgres). Sem ORM — o schema (`sql/001_schema.sql`) é a fonte da verdade. Este documento explica cada tabela e a razão de cada decisão.

## Princípios

- **PK sempre `UUID`** com `gen_random_uuid()`.
- **Soft delete**: `is_active BOOLEAN` em toda tabela operacional. Nunca `DELETE` físico — preserva histórico de vendas/compras.
- **Timestamps**: `created_at` e `updated_at` (`TIMESTAMPTZ DEFAULT NOW()`) em toda tabela. `updated_at` atualizado por trigger.
- **Datas de negócio** (`data`, `chegada`) são `DATE` — granularidade de dia basta.
- **Dinheiro** em `NUMERIC(10,2)` — nunca `float`.
- **Estoque por lote**: `compras.qtd_disp` é a verdade do estoque disponível, decrementado ao vincular pedidos. Não há tabela de estoque separada — o lote É o estoque.

## Diagrama de relações

```
clientes 1───∞ pedidos ∞───1 compras
                 │                 │
   (cliente_id)──┘                 └──(compra_id, nullable: lote de baixa)
```

- Um **cliente** tem muitos **pedidos**.
- Um **pedido** pertence a um cliente e (opcionalmente) é abatido de uma **compra** (lote).
- Uma **compra** (lote) abastece muitos pedidos; `qtd_disp` controla quanto resta.

## Tabelas

### `monjaro.clientes`
Quem compra. Cadastro mínimo (decisão do operador: só nome, contato e frequência).

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `nome` | TEXT NOT NULL | identificação |
| `contato` | TEXT NOT NULL | WhatsApp (usado no botão de acionamento) |
| `frequencia` | INT NULL | estimativa inicial de **dias** entre recompras (opcional desde a `004`) |
| `dose` | TEXT NULL | opcional, texto livre (não estruturado) |
| `perdido_em` | DATE NULL | data em que o cliente recusou (funil "Perdido", migration `005`) |
| `negociacao_em` | DATE NULL | retomada manual de negociação no funil (migration `006`) |
| `origem` | TEXT NULL | quem trouxe o cliente: `maysa` · `lucas` (migration `008`) |
| `anotacao` | TEXT NULL | anotação livre do operador (migration `008`) |
| `valor_negociacao` | NUMERIC(10,2) NULL | preço da negociação em andamento (migration `010`) |
| `forma_pagamento` | TEXT NULL | preferência do cliente: `pix` · `cartao` (migration `011`) |
| `indicado_por` | UUID NULL FK → clientes(id) | quem indicou o cliente; cadeia multinível sai da FK (migration `014`) |
| `is_active` | BOOLEAN NOT NULL DEFAULT true | soft delete |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ DEFAULT NOW() | trigger |

Notas:
- `frequencia` é só a **estimativa inicial** (opcional): a partir da 2ª compra a frequência efetiva é calculada do histórico pela view `v_cliente_recompra` e prevalece (migration `004`, ADR-013, `business-rules.md` §1).
- `contato` deve ser normalizável para link `wa.me` (ver `business-rules.md` → WhatsApp).

### `monjaro.compras`
Lotes comprados do fornecedor. Cada lote é uma unidade de estoque e de custo.

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | UUID PK | |
| `data` | DATE NOT NULL | data da compra |
| `qtd` | INT NOT NULL | total comprado (alertar se < 20 — ver business-rules) |
| `qtd_disp` | INT NOT NULL | disponível; decrementa a cada pedido vinculado |
| `custo_total` | NUMERIC(10,2) NOT NULL | valor pago no lote; `0` = estoque em mãos (só expedição — fora de `v_lucro_por_lote`) |
| `custo_unit` | NUMERIC(10,2) NOT NULL | `custo_total / qtd` (calculado na aplicação) |
| `pagamento` | TEXT NOT NULL DEFAULT 'pendente' | `pendente` · `parcial` · `pago` · `sem_pagamento` |
| `chegada` | DATE NULL | previsão/efetiva de chegada |
| `referencia` | TEXT NULL | ex.: "Lote #001" |
| `is_active` | BOOLEAN NOT NULL DEFAULT true | soft delete |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ DEFAULT NOW() | trigger |

Notas:
- `qtd_disp` inicia igual a `qtd`. Invariante: `0 <= qtd_disp <= qtd`.
- `custo_unit` é base do cálculo de lucro por cliente (ver `business-rules.md`).
- Soft delete de um lote não deve apagar pedidos já vinculados — só some das listas ativas.

### `monjaro.pedidos`
Vendas. Cada pedido é uma venda a um cliente, opcionalmente abatida de um lote.

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | UUID PK | |
| `cliente_id` | UUID NOT NULL FK → clientes(id) | |
| `compra_id` | UUID NULL FK → compras(id) | lote de baixa (nullable até vincular) |
| `data` | DATE NOT NULL | data do pedido |
| `dose` | TEXT NULL | opcional |
| `qtd` | INT NOT NULL DEFAULT 1 | unidades (produto único de 4ml) |
| `valor` | NUMERIC(10,2) NOT NULL | receita do pedido |
| `pagamento` | TEXT NOT NULL DEFAULT 'pendente' | `pendente` · `parcial` · `pago` · `bonificado` |
| `entrega` | TEXT NOT NULL DEFAULT 'aguardando' | `aguardando` · `separado` · `entregue` |
| `is_active` | BOOLEAN NOT NULL DEFAULT true | soft delete |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ DEFAULT NOW() | trigger |

Notas:
- Ao vincular `compra_id`, decrementar `compras.qtd_disp` em `qtd` (ver `business-rules.md` → Estoque). Ao desvincular/cancelar, devolver.
- `data` + `cliente.frequencia` define a próxima data de recompra esperada (base do alerta de Início).
- Status de pagamento/entrega são strings controladas — validar no front contra a lista permitida.

### `monjaro.lancamentos`
Despesa ou receita avulsa ligada a um cliente, fora do fluxo de pedido/lote (ex.: reembolso, taxa extra). Migration `015`.

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | UUID PK | |
| `cliente_id` | UUID NOT NULL FK → clientes(id) | sempre ligado a um cliente, sem lançamento "geral" |
| `tipo` | TEXT NOT NULL | `receita` · `despesa` (CHECK) |
| `valor` | NUMERIC(10,2) NOT NULL | sempre positivo (CHECK `> 0`) — o sinal vem do `tipo` |
| `descricao` | TEXT NULL | detalhe livre do lançamento |
| `data` | DATE NOT NULL DEFAULT CURRENT_DATE | |
| `is_active` | BOOLEAN NOT NULL DEFAULT true | soft delete |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ DEFAULT NOW() | trigger |

Notas:
- Entra no lucro por cliente (incorporado ao número exibido) e no consolidado do Financeiro: `lucro_total += Σreceita − Σdespesa` (ver `business-rules.md` §4).
- Não afeta `investido`/`recebido`/`a_receber` do consolidado — esses são conceitos específicos de lote/pedido.

### `monjaro.followups` (colunas de IA — migration `018`)
Tabela criada na `007` (não documentada aqui até agora). Colunas novas, ligadas à geração de mensagem por IA (`business-rules.md` §6):

| Coluna | Tipo | Observação |
|---|---|---|
| `ia_request_id` | BIGINT NULL | id da chamada assíncrona ao `pg_net` pra API de IA (não é o `request_id` do envio Evolution) |
| `mensagem_ia` | TEXT NULL | texto gerado pela IA, se a resposta chegou a tempo; `NULL` = segue com `mensagem` (fallback) |

`monjaro.config` ganhou as chaves `ai_chat_url`, `ai_chat_token`, `ai_model` (mesmo padrão RLS-deny das credenciais Evolution — ver `017_config_ia.sql`).

## Domínios de valores (enums por convenção, validados na aplicação)

| Campo | Valores |
|---|---|
| `compras.pagamento` | `pendente`, `parcial`, `pago`, `sem_pagamento` (estoque em mãos, sem dívida) |
| `pedidos.pagamento` | `pendente`, `parcial`, `pago`, `bonificado` (brinde — valor 0, baixa estoque, sem receita) |
| `pedidos.entrega` | `aguardando`, `separado`, `entregue` |

> Mantidos como TEXT (não `CHECK`/`ENUM` no MVP) para flexibilidade; a aplicação restringe ao conjunto acima. Se virar fonte de bug, promover para `CHECK` numa migration `002`.

## Índices

```sql
CREATE INDEX IF NOT EXISTS ix_pedidos_cliente   ON monjaro.pedidos(cliente_id);
CREATE INDEX IF NOT EXISTS ix_pedidos_compra    ON monjaro.pedidos(compra_id);
CREATE INDEX IF NOT EXISTS ix_pedidos_data      ON monjaro.pedidos(data DESC);
CREATE INDEX IF NOT EXISTS ix_clientes_ativos   ON monjaro.clientes(is_active);
CREATE INDEX IF NOT EXISTS ix_compras_ativos    ON monjaro.compras(is_active);
```

## Views úteis (criadas no `001_schema.sql`)

```sql
-- Lucro por lote: receita dos pedidos vinculados - custo do lote
CREATE OR REPLACE VIEW monjaro.v_lucro_por_lote AS
SELECT c.id AS compra_id, c.referencia, c.qtd, c.qtd_disp,
       c.custo_total,
       COALESCE(SUM(p.valor), 0) AS receita,
       COALESCE(SUM(p.valor), 0) - c.custo_total AS lucro
FROM monjaro.compras c
LEFT JOIN monjaro.pedidos p
       ON p.compra_id = c.id AND p.is_active
WHERE c.is_active
GROUP BY c.id;

-- Tendência mensal (dashboard do Financeiro): receita e custo agrupados
-- por mês do pedido, mesma regra de v_lucro_por_lote (só pedido pago,
-- custo rateado por qtd * custo_unit do lote vinculado). Migration 016.
CREATE OR REPLACE VIEW monjaro.v_financeiro_mensal AS
SELECT date_trunc('month', p.data)::date AS mes,
       COALESCE(SUM(p.valor) FILTER (WHERE p.pagamento = 'pago'), 0) AS receita,
       COALESCE(SUM(p.qtd * cp.custo_unit) FILTER (WHERE p.pagamento = 'pago'), 0) AS custo,
       COUNT(*) FILTER (WHERE p.pagamento = 'pago') AS pedidos_pagos
FROM monjaro.pedidos p
LEFT JOIN monjaro.compras cp ON cp.id = p.compra_id
WHERE p.is_active
GROUP BY 1
ORDER BY 1;

-- Recompra por cliente: frequência EFETIVA (média dos intervalos entre
-- datas distintas de pedidos quando >= 2 compras; senão a estimativa
-- manual) + próxima recompra. Redefinida na migration 004 — ver
-- sql/004_frequencia_calculada.sql para o SQL vigente.
-- Colunas: cliente_id, nome, contato, frequencia, ultimo_pedido,
--          proxima_recompra, compras, ultimo_valor (migration 009 —
--          valor da última venda, apoio à negociação)
```

> O cálculo do **status** do alerta (`atrasado`/`alerta`/`ok`) e do **lucro por cliente** pode ficar na aplicação (mais simples de iterar) ou virar view depois. Regra em `business-rules.md`.

## `updated_at` automático

```sql
CREATE OR REPLACE FUNCTION monjaro.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
-- aplicar trigger BEFORE UPDATE em clientes, compras, pedidos (ver 001_schema.sql)
```

## Convenção de migrations

- `sql/001_schema.sql` cria schema, tabelas, índices, views, trigger e RLS.
- Migrations seguintes: `sql/002_descricao.sql`, sequenciais, idempotentes (`IF NOT EXISTS`, `CREATE OR REPLACE`).
- Nunca editar uma migration já aplicada — criar nova.
- RLS e exposição da `anon key`: ver `security.md`.
