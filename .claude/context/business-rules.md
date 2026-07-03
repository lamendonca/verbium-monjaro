# Regras de negócio — Monjaro

Lógica do domínio: alertas de recompra, estoque por lote, lucro e WhatsApp. Substitui o antigo `discovery.md` (que era varredura de rede do projeto herdado e não se aplica aqui). Esta é a "inteligência" do app — implementar exatamente como descrito para os cálculos baterem.

## 1. Alerta de recompra (coração do app)

O operador quer ser avisado **10 dias antes** de o cliente precisar recomprar. A frequência **não é cadastrada obrigatoriamente**: o sistema calcula o ritmo real do cliente a partir do histórico (ADR-013).

**Frequência efetiva** (calculada na view `v_cliente_recompra`, migration `004`):
```
compras (datas distintas de pedidos ativos) >= 2:
  frequencia = ROUND( (MAX(data) - MIN(data)) / (compras - 1) )   -- média dos intervalos
senão:
  frequencia = clientes.frequencia (estimativa manual OPCIONAL; pode ser NULL)
```
A frequência calculada **prevalece** sobre a estimativa — comportamento real vale mais que chute inicial.

**Definições** (datas em dias, sem hora):
```
ultimo_pedido    = MAX(pedidos.data) do cliente (pedidos ativos)
proxima_recompra = ultimo_pedido + frequencia_efetiva   (NULL se não há frequência)
dias_restantes   = proxima_recompra - hoje
```

**Status do alerta:**
| Condição | Status | Cor (brand.md) |
|---|---|---|
| `dias_restantes < 0` | `atrasado` | vermelho (`--danger`) |
| `0 <= dias_restantes <= 10` | `alerta` | amarelo (`--warning`) |
| `dias_restantes > 10` | `ok` | verde (`--success`) |
| comprou 1x e sem estimativa | `sem_padrao` | cinza — "Aguardando 2ª compra" |
| sem nenhum pedido ainda | `sem_pedido` | cinza (`--text-muted`) |

- A tela **Início** lista clientes com status `atrasado` ou `alerta`, ordenados por `proxima_recompra` ascendente (mais urgente primeiro).
- Clientes `sem_pedido` e `sem_padrao` não entram na lista de acionamento (não há base para prever).
- "Antecedência" é fixa em **10 dias** (decisão do operador). Se virar configurável, vira env/parametrização — não assumir antes de pedir.

> Fonte de dados: view `monjaro.v_cliente_recompra` (ver `data-model.md`) entrega `ultimo_pedido` e `proxima_recompra`. O cálculo de `dias_restantes` e do status pode ficar no JS (`clientes.js`), usando a data local do dispositivo.

## 2. Estoque por lote

Não há tabela de estoque separada — **o lote (`compras`) é o estoque**. `qtd_disp` é a verdade do disponível.

**Invariantes:**
```
Ao criar lote:                 qtd_disp = qtd
Sempre:                        0 <= qtd_disp <= qtd
```

**Movimentações (feitas em `pedidos.js` ao salvar/editar pedido):**
| Ação | Efeito em `compras.qtd_disp` |
|---|---|
| Vincular pedido a um lote (`compra_id` setado) | `qtd_disp -= pedido.qtd` |
| Desvincular / trocar lote | devolver ao lote antigo (`+= qtd`), debitar do novo |
| Editar `qtd` de pedido já vinculado | ajustar pela diferença |
| Soft delete de pedido vinculado | devolver `qtd_disp += pedido.qtd` |

**Regras de proteção:**
- Não permitir vincular se `qtd_disp < pedido.qtd` (estoque insuficiente) — avisar o operador.
- `compra_id` é opcional: um pedido pode existir sem baixa de lote (ex.: venda avulsa) e ser vinculado depois.

> ⚠️ Sem transações multi-statement no client. Como é single-user, a corrida é improvável, mas implementar o decremento logo após o insert do pedido e, em erro, reverter. Se virar problema, mover para uma função RPC no Postgres (migration futura).

## 3. Lote mínimo viável

- Comprar só é viável a partir de **20 unidades** (o operador vende ~50 e precisa de ≥20 por lote).
- Ao cadastrar um lote com `qtd < 20`, mostrar **aviso não bloqueante** ("Lote abaixo do mínimo viável de 20"). Não impedir — só sinalizar.

## 4. Financeiro

### Custo unitário do lote
```
compras.custo_unit = custo_total / qtd      (calcular na aplicação ao salvar)
```

### Lucro por lote
```
receita_lote = Σ pedidos.valor  (pedidos ativos com compra_id = lote)
lucro_lote   = receita_lote - compras.custo_total
```
Fonte pronta: view `monjaro.v_lucro_por_lote`. Lucro de lote ainda não esgotado é parcial (parte do estoque não virou receita) — exibir junto `qtd_disp/qtd` para dar contexto.

### Lucro por cliente
Receita recebida do cliente menos o custo estimado das unidades que ele comprou, via custo unitário do lote de cada pedido:
```
receita_cliente = Σ pedidos.valor          (do cliente, pedidos ativos)
custo_cliente   = Σ (pedido.qtd * custo_unit_do_lote_vinculado)
                  -- pedidos sem compra_id: custo desconhecido → tratar como 0
                     e sinalizar "custo não rastreado" na UI
lucro_cliente   = receita_cliente - custo_cliente
```

### Consolidado (tela Financeiro / KPIs do Início)
```
investido    = Σ compras.custo_total            (lotes ativos)
recebido     = Σ pedidos.valor WHERE pagamento='pago'
a_receber    = Σ pedidos.valor WHERE pagamento IN ('pendente','parcial')
lucro_total  = Σ lucro_lote                     (v_lucro_por_lote)
```

> "Recebido parcial": no MVP, `parcial` conta como **a receber** (não temos coluna de valor pago parcial). Se o operador precisar do valor exato pago, adicionar `valor_pago` numa migration futura — não inventar agora.

## 5. WhatsApp (acionamento)

O app **não** envia mensagem automática — só abre o WhatsApp com a mensagem pronta.

**Montagem do link:**
```
numero = só dígitos de cliente.contato; se não tiver DDI, prefixar 55 (Brasil)
texto  = mensagem de recompra (abaixo), URL-encoded
link   = https://wa.me/<numero>?text=<texto>
```

**Mensagem padrão de recompra** (ajustável; manter curto e pessoal):
```
Oi <nome>! Passando pra ver se você já vai querer repor o Monjaro. 😊
```

- Botão WhatsApp aparece no card do cliente e em cada alerta do Início.
- Validar que `contato` tem dígitos suficientes; se não, desabilitar o botão e sinalizar "contato inválido".

## 6. Funil de vendas (kanban do Início)

Fases **derivadas** dos dados — nenhum estado extra persistido. Por cliente ativo, na ordem:

| Condição (1ª que casar) | Fase |
|---|---|
| **Perdido** (`perdido_em` setado, sem pedido posterior) | **Perdido** (visível por 14 dias; depois sai do funil) |
| Sem nenhum pedido | **Não iniciada** ("novo — em negociação") |
| Último pedido com `pagamento ≠ pago` | **Pendente pagamento** |
| Último pedido pago e `entrega ≠ entregue` | **Pago** |
| Ciclo concluído e recompra `atrasado`/`alerta` | **Não iniciada** (retomada automática, com botão WhatsApp) |
| Ciclo concluído, sem alerta | **Entregue medicação** (descansa até o próximo ciclo) |

- Retomada pro funil é automática via alerta de recompra (§1); inclusão manual acontece ao cadastrar o cliente (entra sem pedido → Não iniciada).
- "Não iniciada" ordena por urgência: atrasados → novos → alertas. "Entregue" ordena do mais recente.

**Perdido** (`clientes.perdido_em`, migration `005`): cliente disse que não quer.
- Marcado no detalhe do cliente (botão "Perdido"); sai dos **alertas** e da retomada automática.
- Fica na coluna Perdido por `PERDIDO_DIAS_VISIVEL = 14` dias (constante em `clientes.js`); depois some do funil, mas continua fora dos alertas.
- Volta ao ciclo com **novo pedido** (pedido com data posterior a `perdido_em` anula o perdido — sem write extra) ou pelo botão **Retomar** (limpa `perdido_em`).

## 7. Datas e fuso

- Datas de negócio são **dia** (`DATE`), comparadas no fuso local do dispositivo (operador único, no Brasil).
- "Hoje" = data local do navegador. Não usar UTC para o cálculo de `dias_restantes` (evita erro de ±1 dia).

## 8. Soft delete (reforço)

- "Excluir" qualquer registro = `is_active = false`. Nunca DELETE físico.
- Listas e cálculos consideram só `is_active = true`.
- Soft delete de lote **não** apaga pedidos vinculados; soft delete de pedido vinculado **devolve** estoque ao lote.
