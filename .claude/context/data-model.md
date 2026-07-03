# Modelo de dados — Monjaro

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
| `custo_total` | NUMERIC(10,2) NOT NULL | valor pago no lote |
| `custo_unit` | NUMERIC(10,2) NOT NULL | `custo_total / qtd` (calculado na aplicação) |
| `pagamento` | TEXT NOT NULL DEFAULT 'pendente' | `pendente` · `parcial` · `pago` |
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
| `pagamento` | TEXT NOT NULL DEFAULT 'pendente' | `pendente` · `parcial` · `pago` |
| `entrega` | TEXT NOT NULL DEFAULT 'aguardando' | `aguardando` · `separado` · `entregue` |
| `is_active` | BOOLEAN NOT NULL DEFAULT true | soft delete |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ DEFAULT NOW() | trigger |

Notas:
- Ao vincular `compra_id`, decrementar `compras.qtd_disp` em `qtd` (ver `business-rules.md` → Estoque). Ao desvincular/cancelar, devolver.
- `data` + `cliente.frequencia` define a próxima data de recompra esperada (base do alerta de Início).
- Status de pagamento/entrega são strings controladas — validar no front contra a lista permitida.

## Domínios de valores (enums por convenção, validados na aplicação)

| Campo | Valores |
|---|---|
| `compras.pagamento` | `pendente`, `parcial`, `pago` |
| `pedidos.pagamento` | `pendente`, `parcial`, `pago` |
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

-- Recompra por cliente: frequência EFETIVA (média dos intervalos entre
-- datas distintas de pedidos quando >= 2 compras; senão a estimativa
-- manual) + próxima recompra. Redefinida na migration 004 — ver
-- sql/004_frequencia_calculada.sql para o SQL vigente.
-- Colunas: cliente_id, nome, contato, frequencia, ultimo_pedido,
--          proxima_recompra, compras
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
