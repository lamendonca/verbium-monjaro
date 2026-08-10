// financeiro.js — lucro por lote, por cliente e consolidado.
// Fórmulas em business-rules.md §4. 'parcial' conta como a receber no MVP.

import { db, list, listView } from './db.js';
import {
  el, renderInto, loadingState, emptyState, errorState, fmtMoney, hojeISO,
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
    // bonificado é brinde — não é dinheiro a entrar
    a_receber: pedidos.filter((p) => p.pagamento === 'pendente' || p.pagamento === 'parcial')
      .reduce((s, p) => s + Number(p.valor), 0),
    lucro_total: viewLotes.reduce((s, l) => s + Number(l.lucro), 0),
  };
}

// ---- Indicações do mês (business-rules.md §4) ----
// Qualquer venda paga de cliente indicado conta (recorrência inclusa),
// pela data do pedido. A cadeia multinível sai da FK indicado_por: o
// indicador direto recebe como "direta" e os acima dele como "indireta".
// Bonificar é decisão manual (a regra muda por campanha) — aqui é só
// visibilidade, incluindo quem já recebeu pedido bonificado no mês.
export async function indicacoesDoMes(mesISO) {
  const inicio = `${mesISO}-01`;
  const [ano, mes] = mesISO.split('-').map(Number);
  const fim = `${mesISO}-${String(new Date(ano, mes, 0).getDate()).padStart(2, '0')}`;
  const [clientes, { data: vendas, error }, { data: brindes, error: e2 }] = await Promise.all([
    list('clientes', { select: 'id, nome, indicado_por' }),
    db.from('pedidos').select('valor, cliente_id')
      .eq('is_active', true).eq('pagamento', 'pago').gte('data', inicio).lte('data', fim),
    db.from('pedidos').select('cliente_id')
      .eq('is_active', true).eq('pagamento', 'bonificado').gte('data', inicio).lte('data', fim),
  ]);
  if (error) throw new Error(error.message);
  if (e2) throw new Error(e2.message);
  const porId = new Map(clientes.map((c) => [c.id, c]));
  const jaBonificados = new Set(brindes.map((b) => b.cliente_id));
  const stats = new Map();
  for (const v of vendas) {
    const comprador = porId.get(v.cliente_id);
    if (!comprador?.indicado_por) continue;
    const visitados = new Set([comprador.id]); // trava contra ciclo na cadeia
    let nivel = 1;
    let indicadorId = comprador.indicado_por;
    while (indicadorId && !visitados.has(indicadorId)) {
      visitados.add(indicadorId);
      const indicador = porId.get(indicadorId);
      if (!indicador) break;
      const s = stats.get(indicadorId) || {
        nome: indicador.nome,
        diretas: { qtd: 0, total: 0, nomes: new Set() },
        indiretas: { qtd: 0, total: 0, nomes: new Set() },
      };
      const alvo = nivel === 1 ? s.diretas : s.indiretas;
      alvo.qtd += 1;
      alvo.total += Number(v.valor);
      alvo.nomes.add(comprador.nome);
      stats.set(indicadorId, s);
      indicadorId = indicador.indicado_por;
      nivel += 1;
    }
  }
  return [...stats.entries()]
    .map(([id, s]) => ({ ...s, bonificado: jaBonificados.has(id) }))
    .sort((a, b) => (b.diretas.total + b.indiretas.total) - (a.diretas.total + a.indiretas.total));
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

function cardIndicador(i) {
  const linha = (rotulo, n) =>
    `${rotulo}: ${n.qtd} venda(s) · ${fmtMoney(n.total)} — ${[...n.nomes].join(', ')}`;
  return el('div', { class: 'list-item' },
    el('div', { class: 'info' },
      el('div', { class: 'title' }, i.nome),
      i.diretas.qtd ? el('div', { class: 'sub' }, linha('diretas', i.diretas)) : null,
      i.indiretas.qtd ? el('div', { class: 'sub' }, linha('indiretas', i.indiretas)) : null,
      i.bonificado
        ? el('div', { class: 'badges' }, el('span', { class: 'badge badge-purple' }, 'bonificado ✓'))
        : null),
    el('div', { class: 'actions' },
      el('div', { class: 'title', style: 'color: var(--primary)' },
        fmtMoney(i.diretas.total + i.indiretas.total))));
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
  const listaIndicacoes = document.getElementById('lista-fin-indicacoes');
  const mesIndicacoes = document.getElementById('fin-mes-indicacoes');
  mesIndicacoes.value = hojeISO().slice(0, 7); // mês corrente

  async function renderIndicacoes() {
    loadingState(listaIndicacoes);
    try {
      const indicadores = await indicacoesDoMes(mesIndicacoes.value || hojeISO().slice(0, 7));
      if (indicadores.length) renderInto(listaIndicacoes, indicadores.map(cardIndicador));
      else emptyState(listaIndicacoes, '🤝', 'Nenhuma venda de indicado neste mês.');
    } catch {
      errorState(listaIndicacoes);
    }
  }
  mesIndicacoes.addEventListener('change', renderIndicacoes);

  async function refresh() {
    loadingState(listaLotes);
    loadingState(listaClientes);
    renderIndicacoes();
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
