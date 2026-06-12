// compras.js — CRUD de lotes (compras) + estoque disponível. STUB: spec abaixo.
//
// Dados: monjaro.compras (data*, qtd*, qtd_disp, custo_total*, custo_unit,
//        pagamento, chegada?, referencia?). O lote É o estoque. Soft delete.
// Acesso ao banco SEMPRE via ./db.js. Telas/fluxo em ui.md → Lotes.
//
// Responsabilidades:
//   - listar()        → lotes ativos, mais recentes primeiro; expõe qtd_disp/qtd.
//   - salvar(lote)    → insert/update via modal.
//       * custo_unit = custo_total / qtd (calcular na app).
//       * ao criar: qtd_disp = qtd.
//       * aviso NÃO bloqueante se qtd < 20 (lote mínimo viável — business-rules.md §3).
//   - remover(id)     → soft delete (não apaga pedidos vinculados).
//   - estoqueLivre()  → Σ qtd_disp dos lotes ativos (KPI do Início).
//
// Decremento de qtd_disp é feito por pedidos.js ao vincular pedidos — não aqui.

import { db } from './db.js';

// TODO: implementar conforme spec acima. Ver business-rules.md §2/§3/§4, ui.md.
export {};
