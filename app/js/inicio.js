// inicio.js — dashboard: KPIs, funil de vendas (kanban) e alertas de recompra.
// Compõe dados de clientes.js, pedidos.js, compras.js e financeiro.js.
// Funil: fases derivadas do último pedido + status de recompra
// (business-rules.md §8) — nenhum estado extra é persistido.

import { listarClientes, recompraPorCliente, botaoWhatsApp } from './clientes.js';
import { listarPedidos } from './pedidos.js';
import { estoqueLivre } from './compras.js';
import { consolidado } from './financeiro.js';
import {
  el, renderInto, loadingState, emptyState, errorState, fmtMoney, fmtData,
} from './ui.js';

function itemAlerta(a) {
  const atrasado = a.status === 'atrasado';
  const sub = atrasado
    ? `atrasado há ${Math.abs(a.dias_restantes)} dia(s)`
    : a.dias_restantes === 0 ? 'recompra hoje' : `recompra em ${a.dias_restantes} dia(s)`;
  return el('div', { class: 'list-item' },
    el('div', { class: 'info' },
      el('div', { class: 'title' }, a.nome),
      el('div', { class: 'sub' }, sub),
      el('div', { class: 'badges' },
        el('span', { class: `badge ${atrasado ? 'badge-red' : 'badge-yellow'}` },
          atrasado ? 'Atrasado' : 'Alerta'))),
    el('div', { class: 'actions' }, botaoWhatsApp(a.nome, a.contato)));
}

// ---- Funil (kanban) ----
// Ordem de decisão por cliente: pedido em aberto > retomada por recompra >
// descanso em "entregue". Cliente sem pedido = topo do funil.
function montarFunil(clientes, recompraMap, ultimoPedidoMap) {
  const fases = { nao_iniciada: [], pendente: [], pago: [], entregue: [] };
  for (const c of clientes) {
    const r = recompraMap.get(c.id);
    const p = ultimoPedidoMap.get(c.id);
    if (!p) {
      fases.nao_iniciada.push({ c, sub: 'novo — em negociação', urgencia: 1 });
    } else if (p.pagamento !== 'pago') {
      fases.pendente.push({ c, sub: `${fmtMoney(p.valor)} · pedido de ${fmtData(p.data)}` });
    } else if (p.entrega !== 'entregue') {
      fases.pago.push({ c, sub: `${fmtMoney(p.valor)} · pago, separar/entregar` });
    } else if (r?.status === 'atrasado' || r?.status === 'alerta') {
      const sub = r.status === 'atrasado'
        ? `recompra atrasada há ${Math.abs(r.dias_restantes)} dia(s)`
        : `recompra em ${r.dias_restantes} dia(s)`;
      fases.nao_iniciada.push({ c, sub, urgencia: r.status === 'atrasado' ? 0 : 2, whatsapp: true });
    } else {
      fases.entregue.push({ c, sub: `entregue em ${fmtData(p.data)}`, data: p.data });
    }
  }
  fases.nao_iniciada.sort((a, b) => (a.urgencia ?? 9) - (b.urgencia ?? 9));
  fases.entregue.sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  return fases;
}

function cardFunil({ c, sub, whatsapp }) {
  return el('div', { class: 'kanban-card' },
    el('div', { class: 'title' }, c.nome),
    el('div', { class: 'sub' }, sub),
    whatsapp ? el('div', { class: 'acao' }, botaoWhatsApp(c.nome, c.contato)) : null);
}

function colunaFunil(titulo, cards) {
  return el('div', { class: 'kanban-col' },
    el('div', { class: 'col-title' }, titulo, el('span', { class: 'count' }, cards.length)),
    cards.length
      ? cards.map(cardFunil)
      : el('div', { class: 'vazio' }, '—'));
}

export function initInicio() {
  const listaAlertas = document.getElementById('lista-alertas');
  const funilEl = document.getElementById('funil');

  async function refresh() {
    loadingState(listaAlertas);
    loadingState(funilEl);
    try {
      const [clientes, pedidos, recompra, estoque, cons] = await Promise.all([
        listarClientes(), listarPedidos(), recompraPorCliente(), estoqueLivre(), consolidado(),
      ]);
      document.getElementById('kpi-clientes').textContent = clientes.length;
      document.getElementById('kpi-estoque').textContent = `${estoque} un`;
      document.getElementById('kpi-areceber').textContent = fmtMoney(cons.a_receber);
      const kpiLucro = document.getElementById('kpi-lucro');
      kpiLucro.textContent = fmtMoney(cons.lucro_total);
      kpiLucro.style = `color: var(${cons.lucro_total >= 0 ? '--success' : '--danger'})`;

      // listarPedidos vem ordenado do mais recente — 1º de cada cliente = último.
      const ultimoPedidoMap = new Map();
      for (const p of pedidos) {
        if (!ultimoPedidoMap.has(p.cliente_id)) ultimoPedidoMap.set(p.cliente_id, p);
      }
      const recompraMap = new Map(recompra.map((r) => [r.cliente_id, r]));
      const fases = montarFunil(clientes, recompraMap, ultimoPedidoMap);
      renderInto(funilEl, [
        colunaFunil('Não iniciada', fases.nao_iniciada),
        colunaFunil('Pendente pagamento', fases.pendente),
        colunaFunil('Pago', fases.pago),
        colunaFunil('Entregue medicação', fases.entregue),
      ]);

      const avisos = recompra
        .filter((r) => r.status === 'atrasado' || r.status === 'alerta')
        .sort((a, b) => a.proxima_recompra.localeCompare(b.proxima_recompra));
      if (avisos.length) renderInto(listaAlertas, avisos.map(itemAlerta));
      else emptyState(listaAlertas, '🎉', 'Ninguém para acionar nos próximos 10 dias.');
    } catch {
      errorState(funilEl);
      errorState(listaAlertas);
    }
  }

  return refresh;
}
