// financeiro.js — lucro por lote, por cliente e consolidado.
// Fórmulas em business-rules.md §4. 'parcial' conta como a receber no MVP.

import { db, list, listView } from './db.js';
import {
  el, renderInto, loadingState, emptyState, errorState, fmtMoney,
} from './ui.js';

export const lucroPorLote = () => listView('v_lucro_por_lote');

export async function lucroPorCliente() {
  const { data, error } = await db.from('pedidos')
    .select('cliente_id, qtd, valor, compra_id, cliente:cliente_id(nome), lote:compra_id(custo_unit)')
    .eq('is_active', true);
  if (error) throw new Error(error.message);
  const porCliente = new Map();
  for (const p of data) {
    const c = porCliente.get(p.cliente_id) ||
      { nome: p.cliente?.nome || '—', receita: 0, custo: 0, pedidos: 0, naoRastreado: false };
    c.receita += Number(p.valor);
    c.pedidos += 1;
    if (p.compra_id && p.lote) c.custo += p.qtd * Number(p.lote.custo_unit);
    else c.naoRastreado = true; // sem lote vinculado → custo desconhecido (0)
    porCliente.set(p.cliente_id, c);
  }
  return [...porCliente.values()]
    .map((c) => ({ ...c, lucro: c.receita - c.custo }))
    .sort((a, b) => b.lucro - a.lucro);
}

export async function consolidado() {
  const [lotes, viewLotes, { data: pedidos, error }] = await Promise.all([
    list('compras', { select: 'custo_total' }),
    lucroPorLote(),
    db.from('pedidos').select('valor, pagamento').eq('is_active', true),
  ]);
  if (error) throw new Error(error.message);
  return {
    investido: lotes.reduce((s, l) => s + Number(l.custo_total), 0),
    recebido: pedidos.filter((p) => p.pagamento === 'pago').reduce((s, p) => s + Number(p.valor), 0),
    a_receber: pedidos.filter((p) => p.pagamento !== 'pago').reduce((s, p) => s + Number(p.valor), 0),
    lucro_total: viewLotes.reduce((s, l) => s + Number(l.lucro), 0),
  };
}

// ---- Tela Financeiro ----
const corLucro = (v) => `color: var(${v >= 0 ? '--success' : '--danger'})`;

function cardLote(lote) {
  const vendidas = lote.qtd - lote.qtd_disp;
  return el('div', { class: 'list-item' },
    el('div', { class: 'info' },
      el('div', { class: 'title' }, lote.referencia || 'Lote sem referência'),
      el('div', { class: 'sub' },
        `${vendidas}/${lote.qtd} vendidas · receita ${fmtMoney(lote.receita)} · custo ${fmtMoney(lote.custo_total)}`),
      lote.qtd_disp > 0 ? el('div', { class: 'sub' }, 'lucro parcial — lote não esgotado') : null),
    el('div', { class: 'actions' },
      el('div', { class: 'title', style: corLucro(lote.lucro) }, fmtMoney(lote.lucro))));
}

function cardCliente(c) {
  return el('div', { class: 'list-item' },
    el('div', { class: 'info' },
      el('div', { class: 'title' }, c.nome),
      el('div', { class: 'sub' },
        `${c.pedidos} pedido(s) · receita ${fmtMoney(c.receita)} · custo ${fmtMoney(c.custo)}`),
      c.naoRastreado
        ? el('div', { class: 'badges' }, el('span', { class: 'badge badge-gray' }, 'custo não rastreado'))
        : null),
    el('div', { class: 'actions' },
      el('div', { class: 'title', style: corLucro(c.lucro) }, fmtMoney(c.lucro))));
}

export function initFinanceiro() {
  const listaLotes = document.getElementById('lista-fin-lotes');
  const listaClientes = document.getElementById('lista-fin-clientes');

  async function refresh() {
    loadingState(listaLotes);
    loadingState(listaClientes);
    try {
      const [cons, lotes, clientes] = await Promise.all([consolidado(), lucroPorLote(), lucroPorCliente()]);
      document.getElementById('fin-investido').textContent = fmtMoney(cons.investido);
      document.getElementById('fin-recebido').textContent = fmtMoney(cons.recebido);
      document.getElementById('fin-areceber').textContent = fmtMoney(cons.a_receber);
      const lucroEl = document.getElementById('fin-lucro');
      lucroEl.textContent = fmtMoney(cons.lucro_total);
      lucroEl.style = corLucro(cons.lucro_total);

      if (lotes.length) renderInto(listaLotes, lotes.map(cardLote));
      else emptyState(listaLotes, '📦', 'Nenhum lote ainda.');
      if (clientes.length) renderInto(listaClientes, clientes.map(cardCliente));
      else emptyState(listaClientes, '👤', 'Nenhum pedido ainda.');
    } catch {
      errorState(listaLotes);
      errorState(listaClientes);
    }
  }

  return refresh;
}
