// pedidos.js — CRUD de pedidos + vínculo a lote + baixa de estoque. STUB: spec abaixo.
//
// Dados: monjaro.pedidos (cliente_id*, compra_id?, data*, qtd, valor*, pagamento, entrega, dose?).
// Acesso ao banco SEMPRE via ./db.js. Telas/fluxo em ui.md → Pedidos.
//
// Responsabilidades:
//   - listar(filtro?)     → pedidos ativos, mais recentes primeiro; filtro por status
//                           (Todos | Pendentes pagamento | A entregar).
//   - salvar(pedido)      → insert/update via modal. Selects: cliente (ativos),
//                           lote (compras com qtd_disp > 0).
//   - remover(id)         → soft delete; se vinculado a lote, DEVOLVER estoque.
//   - vincularLote(pedido, compra_id):
//       * validar estoque: exige compras.qtd_disp >= pedido.qtd (senão avisar).
//       * decrementar compras.qtd_disp em pedido.qtd.
//       * em troca de lote: devolver ao antigo e debitar do novo.
//       * em edição de qtd: ajustar pela diferença.
//     Regras completas em business-rules.md §2 (Estoque).
//
// Atomicidade: sem transação no client (single-user). Em erro após insert,
//   reverter o decremento. Se virar problema, mover para RPC no Postgres.

import { db } from './db.js';

// TODO: implementar conforme spec acima. Ver business-rules.md §2, data-model.md, ui.md.
export {};
