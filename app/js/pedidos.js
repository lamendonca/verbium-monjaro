// pedidos.js — CRUD de pedidos + vínculo a lote + baixa/devolução de estoque.
// Movimentações de compras.qtd_disp em business-rules.md §2. Sem transação no
// client (single-user): valida antes, grava o pedido e ajusta o estoque em
// seguida; erro no ajuste é sinalizado ao operador.

import { db, list, insert, update, softDelete } from './db.js';
import { listarClientes } from './clientes.js';
import { listarLotes } from './compras.js';
import {
  el, renderInto, loadingState, emptyState, errorState,
  fmtMoney, fmtData, hojeISO, openModal, closeModal, toast,
} from './ui.js';

const SELECT_PEDIDO = '*, cliente:cliente_id(nome), lote:compra_id(referencia, data)';

export async function listarPedidos() {
  const { data, error } = await db.from('pedidos')
    .select(SELECT_PEDIDO)
    .eq('is_active', true)
    .order('data', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

async function ajustarEstoque(compraId, delta) {
  if (!compraId || !delta) return;
  const { data, error } = await db.from('compras').select('qtd_disp').eq('id', compraId).single();
  if (error) throw new Error(error.message);
  const { error: e2 } = await db.from('compras')
    .update({ qtd_disp: data.qtd_disp + delta })
    .eq('id', compraId);
  if (e2) throw new Error(e2.message);
}

// Estoque efetivamente livre para este pedido: qtd_disp do lote + o que o
// próprio pedido já ocupa nele (em edição, essa parte volta antes de debitar).
async function validarEstoque(compraId, qtdNecessaria, anterior) {
  const { data, error } = await db.from('compras').select('qtd_disp').eq('id', compraId).single();
  if (error) throw new Error(error.message);
  const devolucao = anterior?.compra_id === compraId ? anterior.qtd : 0;
  return data.qtd_disp + devolucao >= qtdNecessaria;
}

// anterior = estado salvo do pedido em edição ({compra_id, qtd}) ou null.
export async function salvarPedido(pedido, anterior) {
  if (pedido.compra_id && !(await validarEstoque(pedido.compra_id, pedido.qtd, anterior))) {
    throw new Error('estoque_insuficiente');
  }
  const { id, ...resto } = pedido;
  const salvo = id ? await update('pedidos', id, resto) : await insert('pedidos', resto);
  // Devolve ao lote antigo e debita do novo (mesmo lote → ajuste líquido).
  if (anterior?.compra_id === pedido.compra_id) {
    await ajustarEstoque(pedido.compra_id, (anterior?.qtd || 0) - pedido.qtd);
  } else {
    await ajustarEstoque(anterior?.compra_id, anterior?.qtd || 0);
    await ajustarEstoque(pedido.compra_id, -pedido.qtd);
  }
  return salvo;
}

export async function removerPedido(pedido) {
  await softDelete('pedidos', pedido.id);
  await ajustarEstoque(pedido.compra_id, pedido.qtd); // devolve estoque
}

// ---- Tela Pedidos ----
const badgePagamento = {
  pago: ['badge-green', 'Pago'],
  parcial: ['badge-yellow', 'Parcial'],
  pendente: ['badge-red', 'Pendente'],
};
const badgeEntrega = {
  entregue: ['badge-green', 'Entregue'],
  separado: ['badge-yellow', 'Separado'],
  aguardando: ['badge-gray', 'Aguardando'],
};

const FILTROS = {
  todos: () => true,
  pendentes: (p) => p.pagamento !== 'pago',
  entregar: (p) => p.entrega !== 'entregue',
};

function itemPedido(pedido, onEdit) {
  const [clsP, labelP] = badgePagamento[pedido.pagamento] || ['badge-gray', pedido.pagamento];
  const [clsE, labelE] = badgeEntrega[pedido.entrega] || ['badge-gray', pedido.entrega];
  const lote = pedido.lote ? (pedido.lote.referencia || `lote ${fmtData(pedido.lote.data)}`) : null;
  return el('div', { class: 'list-item' },
    el('div', { class: 'info' },
      el('div', { class: 'title' }, pedido.cliente?.nome || '—'),
      el('div', { class: 'sub' },
        `${fmtData(pedido.data)} · ${pedido.qtd} un · ${fmtMoney(pedido.valor)}${lote ? ` · ${lote}` : ''}`),
      el('div', { class: 'badges' },
        el('span', { class: `badge ${clsP}` }, labelP),
        el('span', { class: `badge ${clsE}` }, labelE),
        !pedido.compra_id ? el('span', { class: 'badge badge-gray' }, 'sem lote') : null)),
    el('div', { class: 'actions' },
      el('button', { class: 'btn btn-outline btn-sm', onclick: () => onEdit(pedido) }, 'Editar')));
}

export function initPedidos() {
  const container = document.getElementById('lista-pedidos');
  const form = document.getElementById('form-pedido');
  const campos = {
    id: document.getElementById('pedido-id'),
    cliente: document.getElementById('pedido-cliente'),
    data: document.getElementById('pedido-data'),
    qtd: document.getElementById('pedido-qtd'),
    valor: document.getElementById('pedido-valor'),
    lote: document.getElementById('pedido-lote'),
    pagamento: document.getElementById('pedido-pagamento'),
    entrega: document.getElementById('pedido-entrega'),
    dose: document.getElementById('pedido-dose'),
  };
  const btnRemover = document.getElementById('btn-remover-pedido');
  let filtroAtivo = 'todos';
  let cache = [];
  let emEdicao = null; // pedido salvo, para ajuste de estoque na edição

  async function preencherSelects(pedido) {
    const [clientes, lotes] = await Promise.all([listarClientes(), listarLotes()]);
    renderInto(campos.cliente, clientes.map((c) => el('option', { value: c.id }, c.nome)));
    // Lotes com estoque + o lote já vinculado ao pedido (mesmo esgotado).
    const opcoes = lotes.filter((l) => l.qtd_disp > 0 || l.id === pedido?.compra_id);
    renderInto(campos.lote, [
      el('option', { value: '' }, 'Sem baixa de lote'),
      ...opcoes.map((l) =>
        el('option', { value: l.id }, `${l.referencia || `Lote ${fmtData(l.data)}`} — ${l.qtd_disp} disp.`)),
    ]);
  }

  async function abrirModal(pedido) {
    form.reset();
    emEdicao = pedido || null;
    await preencherSelects(pedido);
    campos.id.value = pedido?.id || '';
    if (pedido) campos.cliente.value = pedido.cliente_id;
    campos.data.value = pedido?.data || hojeISO();
    campos.qtd.value = pedido?.qtd ?? 1;
    campos.valor.value = pedido?.valor ?? '';
    campos.lote.value = pedido?.compra_id || '';
    campos.pagamento.value = pedido?.pagamento || 'pendente';
    campos.entrega.value = pedido?.entrega || 'aguardando';
    campos.dose.value = pedido?.dose || '';
    document.getElementById('modal-pedido-titulo').textContent = pedido ? 'Editar pedido' : 'Novo pedido';
    btnRemover.classList.toggle('hidden', !pedido);
    openModal('modal-pedido');
  }

  function render() {
    const filtrados = cache.filter(FILTROS[filtroAtivo]);
    if (!filtrados.length) return emptyState(container, '🧾', 'Nenhum pedido aqui. Toque em + para registrar.');
    renderInto(container, filtrados.map((p) => itemPedido(p, abrirModal)));
  }

  async function refresh() {
    loadingState(container);
    try {
      cache = await listarPedidos();
      render();
    } catch {
      errorState(container);
    }
  }

  document.querySelectorAll('#tabs-pedidos .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#tabs-pedidos .tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      filtroAtivo = tab.dataset.filtro;
      render();
    });
  });

  document.getElementById('btn-novo-pedido').addEventListener('click', () => abrirModal(null));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await salvarPedido({
        id: campos.id.value || undefined,
        cliente_id: campos.cliente.value,
        compra_id: campos.lote.value || null,
        data: campos.data.value,
        qtd: Number(campos.qtd.value) || 1,
        valor: Number(campos.valor.value),
        pagamento: campos.pagamento.value,
        entrega: campos.entrega.value,
        dose: campos.dose.value.trim() || null,
      }, emEdicao ? { compra_id: emEdicao.compra_id, qtd: emEdicao.qtd } : null);
      closeModal('modal-pedido');
      toast('Salvo.');
      refresh();
    } catch (err) {
      toast(err.message === 'estoque_insuficiente'
        ? 'Estoque insuficiente nesse lote.'
        : 'Não consegui salvar. Confere a conexão e tenta de novo.');
    }
  });

  btnRemover.addEventListener('click', async () => {
    if (!emEdicao) return;
    if (!confirm('Remover este pedido? Ele sai das listas e o estoque volta ao lote.')) return;
    try {
      await removerPedido({ id: emEdicao.id, compra_id: emEdicao.compra_id, qtd: emEdicao.qtd });
      closeModal('modal-pedido');
      toast('Removido.');
      refresh();
    } catch {
      toast('Não consegui remover. Tenta de novo.');
    }
  });

  return refresh;
}
