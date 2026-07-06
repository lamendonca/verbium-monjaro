// compras.js — CRUD de lotes (compras) + estoque disponível.
// O lote É o estoque: qtd_disp é a verdade do disponível (business-rules.md §2).
// Decremento de qtd_disp é feito por pedidos.js ao vincular pedidos — não aqui.

import { db, list, insert, update, softDelete } from './db.js';
import {
  el, renderInto, loadingState, emptyState, errorState,
  fmtMoney, fmtData, hojeISO, openModal, closeModal, toast,
  submitOnce, onClickOnce, confirmar, parseDecimal,
} from './ui.js';

export const LOTE_MINIMO = 20;

export const listarLotes = () => list('compras', { order: 'data', ascending: false });

export async function estoqueLivre() {
  const lotes = await listarLotes();
  return lotes.reduce((s, l) => s + l.qtd_disp, 0);
}

export async function salvarLote(lote) {
  const patch = { ...lote, custo_unit: Math.round((lote.custo_total / lote.qtd) * 100) / 100 };
  if (lote.id) {
    const { id, ...resto } = patch;
    // Corrigir a qtd do lote move o disponível junto (delta), senão as unidades
    // a mais nunca ficam vendáveis e as a menos estouram o CHECK do banco.
    const { data: atual, error } = await db.from('compras').select('qtd, qtd_disp').eq('id', id).single();
    if (error) throw new Error(error.message);
    const novoDisp = atual.qtd_disp + (lote.qtd - atual.qtd);
    if (novoDisp < 0) throw new Error('qtd_menor_que_vendido');
    resto.qtd_disp = novoDisp;
    return update('compras', id, resto);
  }
  return insert('compras', { ...patch, qtd_disp: patch.qtd });
}

// ---- Tela Lotes ----
const badgePagamento = {
  pago: ['badge-green', 'Pago'],
  parcial: ['badge-yellow', 'Parcial'],
  pendente: ['badge-red', 'Pendente'],
  sem_pagamento: ['badge-gray', 'Sem pagamento'], // estoque em mãos — não é dívida
};

function itemLote(lote, onEdit) {
  const consumo = lote.qtd ? ((lote.qtd - lote.qtd_disp) / lote.qtd) * 100 : 0;
  const [cls, label] = badgePagamento[lote.pagamento] || ['badge-gray', lote.pagamento];
  return el('div', { class: 'list-item' },
    el('div', { class: 'info' },
      el('div', { class: 'title' }, lote.referencia || `Lote de ${fmtData(lote.data)}`),
      el('div', { class: 'sub' },
        Number(lote.custo_total) > 0
          ? `${fmtData(lote.data)} · ${lote.qtd_disp}/${lote.qtd} disponível · ${fmtMoney(lote.custo_total)} (${fmtMoney(lote.custo_unit)}/un)`
          : `${fmtData(lote.data)} · ${lote.qtd_disp}/${lote.qtd} disponível`),
      el('div', { class: 'badges' },
        el('span', { class: `badge ${cls}` }, label),
        Number(lote.custo_total) > 0
          ? null
          : el('span', { class: 'badge badge-gray' }, 'sem custo — fora do lucro'),
        lote.qtd < LOTE_MINIMO ? el('span', { class: 'badge badge-yellow' }, '⚠️ abaixo do mínimo') : null,
        lote.chegada ? el('span', { class: 'badge badge-gray' }, `chegada ${fmtData(lote.chegada)}`) : null),
      el('div', { class: 'progress' },
        el('div', { class: 'fill', style: `width:${consumo}%` }))),
    el('div', { class: 'actions' },
      el('button', { class: 'btn btn-outline btn-sm', onclick: () => onEdit(lote) }, 'Editar')));
}

export function initCompras() {
  const container = document.getElementById('lista-lotes');
  const form = document.getElementById('form-lote');
  const campos = {
    id: document.getElementById('lote-id'),
    data: document.getElementById('lote-data'),
    qtd: document.getElementById('lote-qtd'),
    custo: document.getElementById('lote-custo'),
    pagamento: document.getElementById('lote-pagamento'),
    chegada: document.getElementById('lote-chegada'),
    referencia: document.getElementById('lote-referencia'),
  };
  const avisoMinimo = document.getElementById('lote-aviso-minimo');
  const hintUnit = document.getElementById('lote-custo-unit');
  const btnRemover = document.getElementById('btn-remover-lote');

  function abrirModal(lote) {
    form.reset();
    campos.id.value = lote?.id || '';
    campos.data.value = lote?.data || hojeISO();
    campos.qtd.value = lote?.qtd ?? '';
    campos.custo.value = lote?.custo_total ?? '';
    campos.pagamento.value = lote?.pagamento || 'pendente';
    campos.chegada.value = lote?.chegada || '';
    campos.referencia.value = lote?.referencia || '';
    document.getElementById('modal-lote-titulo').textContent = lote ? 'Editar lote' : 'Novo lote';
    btnRemover.classList.toggle('hidden', !lote);
    atualizarHints();
    openModal('modal-lote');
  }

  function atualizarHints() {
    const qtd = Number(campos.qtd.value);
    const custo = parseDecimal(campos.custo.value);
    avisoMinimo.classList.toggle('hidden', !qtd || qtd >= LOTE_MINIMO);
    hintUnit.textContent = qtd > 0 && custo > 0 ? `Custo unitário: ${fmtMoney(custo / qtd)}` : '';
  }
  campos.qtd.addEventListener('input', atualizarHints);
  campos.custo.addEventListener('input', atualizarHints);

  async function refresh() {
    loadingState(container);
    try {
      const lotes = await listarLotes();
      if (!lotes.length) return emptyState(container, '📦', 'Nenhum lote ainda. Toque em + para cadastrar.');
      renderInto(container, lotes.map((l) => itemLote(l, abrirModal)));
    } catch {
      errorState(container);
    }
  }

  document.getElementById('btn-novo-lote').addEventListener('click', () => abrirModal(null));

  submitOnce(form, async () => {
    try {
      await salvarLote({
        id: campos.id.value || undefined,
        data: campos.data.value,
        qtd: Number(campos.qtd.value),
        custo_total: parseDecimal(campos.custo.value),
        pagamento: campos.pagamento.value,
        chegada: campos.chegada.value || null,
        referencia: campos.referencia.value.trim() || null,
      });
      closeModal('modal-lote');
      toast('Salvo.');
      refresh();
    } catch (err) {
      toast(err.message === 'qtd_menor_que_vendido'
        ? 'Quantidade menor do que o já vendido nesse lote. Ajusta os pedidos antes.'
        : 'Não consegui salvar. Confere a conexão e tenta de novo.');
    }
  });

  onClickOnce(btnRemover, async () => {
    const ref = campos.referencia.value || 'este lote';
    if (!await confirmar(`Remover ${ref}? Ele sai das listas, mas o histórico continua.`, { rotulo: 'Remover' })) return;
    try {
      await softDelete('compras', campos.id.value);
      closeModal('modal-lote');
      toast('Removido.');
      refresh();
    } catch {
      toast('Não consegui remover. Tenta de novo.');
    }
  });

  return refresh;
}
