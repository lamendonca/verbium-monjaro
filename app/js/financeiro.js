// financeiro.js — lucro por lote e por cliente + consolidado. STUB: spec abaixo.
//
// Acesso ao banco SEMPRE via ./db.js. Telas/fluxo em ui.md → Financeiro e KPIs do Início.
// Fórmulas completas em business-rules.md §4.
//
// Responsabilidades:
//   - lucroPorLote()    → ler view monjaro.v_lucro_por_lote
//                         (compra_id, referencia, qtd, qtd_disp, custo_total, receita, lucro).
//   - lucroPorCliente() → receita_cliente − custo_cliente, onde
//                         custo_cliente = Σ (pedido.qtd * custo_unit do lote vinculado);
//                         pedidos sem compra_id → custo 0 + sinalizar "custo não rastreado".
//   - consolidado()     → { investido: Σ custo_total (lotes ativos),
//                           recebido:  Σ valor WHERE pagamento='pago',
//                           a_receber: Σ valor WHERE pagamento IN ('pendente','parcial'),
//                           lucro_total: Σ lucro (v_lucro_por_lote) }.
//
// Formatação: R$ 0,00 (pt-BR). Lucro positivo em --success, negativo em --danger.
// Nota: 'parcial' conta como a_receber no MVP (sem coluna de valor pago). Ver decisions.md.

import { db } from './db.js';

// TODO: implementar conforme spec acima. Ver business-rules.md §4, data-model.md (views).
export {};
