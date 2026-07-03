// inicio.js — dashboard: KPIs + alertas de recompra dos próximos 10 dias.
// Compõe dados de clientes.js (alertas), compras.js (estoque) e
// financeiro.js (consolidado) — mapa tela→módulo em ui.md.

import { listarClientes, alertas, botaoWhatsApp } from './clientes.js';
import { estoqueLivre } from './compras.js';
import { consolidado } from './financeiro.js';
import {
  el, renderInto, loadingState, emptyState, errorState, fmtMoney,
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

export function initInicio() {
  const listaAlertas = document.getElementById('lista-alertas');

  async function refresh() {
    loadingState(listaAlertas);
    try {
      const [clientes, estoque, cons, avisos] = await Promise.all([
        listarClientes(), estoqueLivre(), consolidado(), alertas(),
      ]);
      document.getElementById('kpi-clientes').textContent = clientes.length;
      document.getElementById('kpi-estoque').textContent = `${estoque} un`;
      document.getElementById('kpi-areceber').textContent = fmtMoney(cons.a_receber);
      const kpiLucro = document.getElementById('kpi-lucro');
      kpiLucro.textContent = fmtMoney(cons.lucro_total);
      kpiLucro.style = `color: var(${cons.lucro_total >= 0 ? '--success' : '--danger'})`;

      if (avisos.length) renderInto(listaAlertas, avisos.map(itemAlerta));
      else emptyState(listaAlertas, '🎉', 'Ninguém para acionar nos próximos 10 dias.');
    } catch {
      errorState(listaAlertas);
    }
  }

  return refresh;
}
