// clientes.js — CRUD de clientes + status/alertas de recompra + WhatsApp.
// Regras de recompra em business-rules.md §1; link do WhatsApp em §5.

import { list, insert, update, softDelete, listView } from './db.js';
import {
  el, renderInto, loadingState, emptyState, errorState,
  fmtData, parseDateLocal, hojeLocal, diffDias, openModal, closeModal, toast,
} from './ui.js';

export const listarClientes = () => list('clientes', { order: 'nome' });

export async function salvarCliente(cliente) {
  if (cliente.id) {
    const { id, ...resto } = cliente;
    return update('clientes', id, resto);
  }
  return insert('clientes', cliente);
}

// status ∈ atrasado | alerta | ok | sem_padrao | sem_pedido (business-rules.md §1).
// sem_padrao = já comprou, mas ainda não há frequência (nem calculada nem estimada).
export function statusRecompra({ proxima_recompra, ultimo_pedido } = {}) {
  if (!proxima_recompra) {
    return { status: ultimo_pedido ? 'sem_padrao' : 'sem_pedido', dias_restantes: null };
  }
  const dias = diffDias(parseDateLocal(proxima_recompra), hojeLocal());
  if (dias < 0) return { status: 'atrasado', dias_restantes: dias };
  if (dias <= 10) return { status: 'alerta', dias_restantes: dias };
  return { status: 'ok', dias_restantes: dias };
}

// Base do alerta: view v_cliente_recompra. `frequencia` da view é a EFETIVA:
// calculada do histórico (≥ 2 compras) ou, sem histórico, a estimativa manual.
export async function recompraPorCliente() {
  const rows = await listView('v_cliente_recompra');
  return rows.map((r) => ({ ...r, ...statusRecompra(r) }));
}

// Tela Início: só atrasado/alerta, mais urgente primeiro. sem_pedido fica fora.
export async function alertas() {
  return (await recompraPorCliente())
    .filter((c) => c.status === 'atrasado' || c.status === 'alerta')
    .sort((a, b) => a.proxima_recompra.localeCompare(b.proxima_recompra));
}

export function whatsappLink(nome, contato) {
  let numero = (contato || '').replace(/\D/g, '');
  if (numero.length < 10) return null; // contato inválido — desabilitar botão
  if (numero.length <= 11) numero = `55${numero}`;
  const texto = encodeURIComponent(`Oi ${nome}! Passando pra ver se você já vai querer repor o Monjaro. 😊`);
  return `https://wa.me/${numero}?text=${texto}`;
}

// ---- Tela Clientes ----
const badgeStatus = {
  atrasado: ['badge-red', 'Atrasado'],
  alerta: ['badge-yellow', 'Alerta'],
  ok: ['badge-green', 'Ok'],
  sem_padrao: ['badge-gray', 'Aguardando 2ª compra'],
  sem_pedido: ['badge-gray', 'Sem pedido'],
};

export function botaoWhatsApp(nome, contato) {
  const link = whatsappLink(nome, contato);
  return el('button', {
    class: 'btn btn-whatsapp btn-sm',
    disabled: !link,
    title: link ? 'Chamar no WhatsApp' : 'Contato inválido',
    onclick: () => link && window.open(link, '_blank'),
  }, 'WhatsApp');
}

function itemCliente(cliente, recompra, onEdit) {
  const [cls, label] = badgeStatus[recompra?.status || 'sem_pedido'];
  const ultimo = recompra?.ultimo_pedido ? ` · último ${fmtData(recompra.ultimo_pedido)}` : '';
  // Frequência efetiva vem da view; se calculada do histórico, sinalizar.
  const freq = recompra?.frequencia
    ? `a cada ${recompra.frequencia} dias${recompra.compras >= 2 ? ' (calculado)' : ' (estimado)'}`
    : 'ritmo a definir';
  return el('div', { class: 'list-item' },
    el('div', { class: 'info' },
      el('div', { class: 'title' }, cliente.nome),
      el('div', { class: 'sub' }, `${freq}${ultimo}${cliente.dose ? ` · ${cliente.dose}` : ''}`),
      el('div', { class: 'badges' }, el('span', { class: `badge ${cls}` }, label))),
    el('div', { class: 'actions' },
      botaoWhatsApp(cliente.nome, cliente.contato),
      el('button', { class: 'btn btn-outline btn-sm', onclick: () => onEdit(cliente) }, 'Editar')));
}

export function initClientes() {
  const container = document.getElementById('lista-clientes');
  const busca = document.getElementById('busca-clientes');
  const form = document.getElementById('form-cliente');
  const campos = {
    id: document.getElementById('cliente-id'),
    nome: document.getElementById('cliente-nome'),
    contato: document.getElementById('cliente-contato'),
    frequencia: document.getElementById('cliente-frequencia'),
    dose: document.getElementById('cliente-dose'),
  };
  const btnRemover = document.getElementById('btn-remover-cliente');
  let cache = { clientes: [], recompra: new Map() };

  function abrirModal(cliente) {
    form.reset();
    campos.id.value = cliente?.id || '';
    campos.nome.value = cliente?.nome || '';
    campos.contato.value = cliente?.contato || '';
    campos.frequencia.value = cliente?.frequencia ?? '';
    campos.dose.value = cliente?.dose || '';
    document.getElementById('modal-cliente-titulo').textContent = cliente ? 'Editar cliente' : 'Novo cliente';
    btnRemover.classList.toggle('hidden', !cliente);
    openModal('modal-cliente');
  }

  function render() {
    const termo = busca.value.trim().toLowerCase();
    const filtrados = cache.clientes.filter((c) => c.nome.toLowerCase().includes(termo));
    if (!filtrados.length) {
      return emptyState(container, '👤', termo ? 'Nenhum cliente com esse nome.' : 'Nenhum cliente ainda. Toque em + para cadastrar.');
    }
    renderInto(container, filtrados.map((c) => itemCliente(c, cache.recompra.get(c.id), abrirModal)));
  }

  async function refresh() {
    loadingState(container);
    try {
      const [clientes, recompra] = await Promise.all([listarClientes(), recompraPorCliente()]);
      cache = { clientes, recompra: new Map(recompra.map((r) => [r.cliente_id, r])) };
      render();
    } catch {
      errorState(container);
    }
  }

  busca.addEventListener('input', render);
  document.getElementById('btn-novo-cliente').addEventListener('click', () => abrirModal(null));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await salvarCliente({
        id: campos.id.value || undefined,
        nome: campos.nome.value.trim(),
        contato: campos.contato.value.trim(),
        frequencia: campos.frequencia.value ? Number(campos.frequencia.value) : null,
        dose: campos.dose.value.trim() || null,
      });
      closeModal('modal-cliente');
      toast('Salvo.');
      refresh();
    } catch {
      toast('Não consegui salvar. Confere a conexão e tenta de novo.');
    }
  });

  btnRemover.addEventListener('click', async () => {
    if (!confirm(`Remover ${campos.nome.value}? Ele sai das listas, mas o histórico continua.`)) return;
    try {
      await softDelete('clientes', campos.id.value);
      closeModal('modal-cliente');
      toast('Removido.');
      refresh();
    } catch {
      toast('Não consegui remover. Tenta de novo.');
    }
  });

  return refresh;
}
