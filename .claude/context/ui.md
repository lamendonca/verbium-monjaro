# Interface — telas e fluxos (Mounjaro)

Especificação das telas para implementação. Mobile-first, 1 `app/index.html`, navegação por troca de `.page.active` (sem router). Tokens e componentes em `brand.md`. Regras de cálculo em `business-rules.md`.

## Shell

```
┌───────────────────────────┐
│ HEADER (sticky)           │  título "Gestão Mounjaro" + subtítulo
├───────────────────────────┤
│                           │
│  PÁGINA ATIVA (scroll)    │  só uma .page visível por vez
│                           │
├───────────────────────────┤
│ BOTTOM NAV (fixo)         │  Início · Clientes · Pedidos · Lotes · Financeiro
└───────────────────────────┘
```

- Antes do shell: **tela de login** (token). Sem token válido em `localStorage`, mostra só o login. Ver `auth.js`.
- `padding-bottom` no body reserva espaço para a bottom-nav.
- Botão flutuante "+" (ou no topo da página) abre o modal de cadastro do domínio ativo.

## Navegação (bottom-nav, 5 abas)

| Aba | id da página | Conteúdo |
|---|---|---|
| 🏠 Início | `page-inicio` | KPIs + alertas de recompra (próx. 10 dias) |
| 👤 Clientes | `page-clientes` | Lista + busca + CRUD + status de recompra + WhatsApp |
| 🧾 Pedidos | `page-pedidos` | Lista filtrável + CRUD + vínculo a lote + status |
| 📦 Lotes | `page-lotes` | Lista de compras/lotes + CRUD + estoque disponível |
| 💰 Financeiro | `page-financeiro` | Lucro por lote e por cliente + consolidado |

Trocar de aba: `document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'))` + ativar a alvo; idem nos `.nav-item`.

## Tela: Início (dashboard)

Objetivo: o operador abre o app e vê **quem acionar** e o **resumo do negócio**.

- **Summary grid (2 col)** com KPIs:
  - Clientes ativos
  - Estoque livre (Σ `compras.qtd_disp` dos lotes ativos)
  - A receber (Σ `valor` de pedidos com `pagamento ≠ pago`)
  - Lucro consolidado (Σ lucro por lote) — ver `business-rules.md`
- **Funil de vendas (kanban)**: 4 colunas com rolagem horizontal — Não iniciada · Pendente pagamento · Pago · Entregue medicação. Fases derivadas do último pedido + recompra (`business-rules.md` §6); cards de retomada trazem botão WhatsApp.
- **Card "Acionar nos próximos 10 dias"**: lista de clientes com `status ∈ {atrasado, alerta}`, ordenados por `proxima_recompra` ascendente. Cada linha: nome + sub ("recompra em X dias" / "atrasado há X dias") + badge de status + botão WhatsApp.
- Empty state se ninguém a acionar.

## Tela: Clientes

- Lista de `clientes` ativos (busca por nome opcional).
- Cada `.list-item`: nome + sub ("a cada N dias" + último pedido) + badge de status de recompra + ações (editar, WhatsApp).
- Botão "+": modal de cadastro.
- **Modal cliente** (campos): `nome*`, `contato*` (WhatsApp), `frequencia*` (dias), `dose` (opcional).
- Editar reusa o modal. "Excluir" = soft delete (`is_active=false`) com confirmação.

## Tela: Pedidos

- Lista de `pedidos` ativos, mais recentes primeiro. Filtro por status (tabs: Todos / Pendentes / A entregar).
- Cada item: nome do cliente + data + valor + badges (pagamento, entrega) + lote vinculado (se houver).
- Botão "+": modal de pedido.
- **Modal pedido** (campos): `cliente*` (select de clientes ativos), `data*`, `qtd` (default 1), `valor*`, `compra_id` (select de lotes com `qtd_disp > 0`, opcional), `pagamento` (pendente/parcial/pago), `entrega` (aguardando/separado/entregue), `dose` (opcional).
- Ao salvar com `compra_id`: **decrementa `compras.qtd_disp`** em `qtd` (ver `business-rules.md` → Estoque). Ao trocar/remover o lote, ajustar de volta.
- "Excluir" = soft delete + devolver estoque se estava vinculado.

## Tela: Lotes (compras)

- Lista de `compras` ativas, mais recentes primeiro.
- Cada item: referência + data + `qtd_disp/qtd` disponível + custo total + badge de pagamento + barra de progresso de consumo do lote.
- Aviso visual se `qtd < 20` (lote abaixo do mínimo viável).
- Botão "+": modal de lote.
- **Modal lote** (campos): `data*`, `qtd*`, `custo_total*`, `pagamento` (pendente/parcial/pago), `chegada` (opcional), `referencia` (opcional). `custo_unit` = `custo_total/qtd` (calculado, exibido). `qtd_disp` inicia = `qtd`.
- "Excluir" = soft delete (não apaga pedidos vinculados).

## Tela: Financeiro

- **Por lote** (`v_lucro_por_lote`): card por lote com receita, custo, lucro e nº de unidades vendidas/restantes.
- **Por cliente**: receita recebida − custo estimado (via lote vinculado) — ver `business-rules.md` → Lucro por cliente.
- **Consolidado**: total investido (Σ custo_total), total recebido (Σ valor pago), a receber, lucro líquido.
- Cores: lucro positivo em `--success`, negativo em `--danger`.

## Padrões transversais

- **CRUD**: toda criação/edição via modal slide-up; salvar recarrega a lista da página.
- **Exclusão**: sempre soft delete, sempre com confirmação. Nunca DELETE físico.
- **Estados**: toda lista trata loading, vazio e erro (ver tom de voz em `brand.md`).
- **Formatação**: dinheiro em `R$ 0,00` (pt-BR); datas em `dd/mm`.
- **WhatsApp**: botão abre `wa.me` com mensagem de recompra pré-montada (`business-rules.md`).
- **Sem reload de página**: tudo client-side; navegação e modais manipulam o DOM.

## Mapa tela → módulo JS

| Tela | Módulo principal | Lê/escreve |
|---|---|---|
| Login | `auth.js` | `APP_TOKEN` + `localStorage` |
| Início | `clientes.js` (alertas) + `financeiro.js` (KPIs) | views/recompra |
| Clientes | `clientes.js` | `monjaro.clientes` |
| Pedidos | `pedidos.js` | `monjaro.pedidos` (+ baixa em `compras`) |
| Lotes | `compras.js` | `monjaro.compras` |
| Financeiro | `financeiro.js` | views `v_lucro_por_lote`, agregações |

Todos os módulos acessam o banco **só** via `app/js/db.js`.
