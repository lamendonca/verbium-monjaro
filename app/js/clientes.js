// clientes.js — CRUD de clientes + status/alertas de recompra + WhatsApp.
// Regras de recompra em business-rules.md §1; link do WhatsApp em §5.

import { db, list, insert, update, softDelete, listView } from './db.js';
import {
  el, renderInto, loadingState, emptyState, errorState,
  fmtData, fmtMoney, hojeISO, parseDateLocal, hojeLocal, diffDias,
  openModal, closeModal, toast, submitOnce, onClickOnce, confirmar,
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

// ---- Perdido (business-rules.md §6) ----
// Cliente recusou a recompra. Um pedido posterior à recusa retoma o ciclo
// sozinho; o card fica visível na coluna Perdido por PERDIDO_DIAS_VISIVEL
// dias e depois sai do funil (continua fora dos alertas).
export const PERDIDO_DIAS_VISIVEL = 14;

export function estaPerdido(cliente, ultimoPedidoISO) {
  if (!cliente.perdido_em) return false;
  return !ultimoPedidoISO || ultimoPedidoISO <= cliente.perdido_em;
}

export const marcarPerdido = (id) => update('clientes', id, { perdido_em: hojeISO() });
export const retomarCliente = (id) => update('clientes', id, { perdido_em: null });

// Retomada manual de negociação (arrasto pra "Não iniciada"). Um pedido
// posterior encerra a negociação — derivado, sem write extra.
export const marcarNegociacao = (id) =>
  update('clientes', id, { negociacao_em: hojeISO(), perdido_em: null });

// "+55 62 8300-9910" → "+556283009910"; "(62) 8300-9910" → "6283009910".
// Mantém só o "+" inicial (se houver) e os dígitos.
export function normalizarContato(valor) {
  const s = valor.trim();
  const digitos = s.replace(/\D/g, '');
  return s.startsWith('+') ? `+${digitos}` : digitos;
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

const rotuloOrigem = { maysa: 'Maysa', lucas: 'Lucas' };
const badgeOrigem = (origem) =>
  origem ? el('span', { class: 'badge badge-purple' }, rotuloOrigem[origem] || origem) : null;

const rotuloPagamento = { pix: 'Pix', cartao: 'Cartão' };
const badgeFormaPagamento = (forma) =>
  forma ? el('span', { class: 'badge badge-gray' }, rotuloPagamento[forma] || forma) : null;

export function botaoWhatsApp(nome, contato) {
  const link = whatsappLink(nome, contato);
  return el('button', {
    class: 'btn btn-whatsapp btn-sm',
    disabled: !link,
    title: link ? 'Chamar no WhatsApp' : 'Contato inválido',
    onclick: () => link && window.open(link, '_blank'),
  }, 'WhatsApp');
}

// Torna um badge clicável para virar filtro da lista (tela Clientes).
function tagFiltravel(node, filtro, onTag) {
  if (!node || !onTag) return node;
  node.style.cursor = 'pointer';
  node.addEventListener('click', (e) => {
    e.stopPropagation(); // não abrir o detalhe junto
    onTag(filtro);
  });
  return node;
}

function itemCliente(cliente, recompra, onEdit, onDetalhe, onTag) {
  const [cls, label] = badgeStatus[recompra?.status || 'sem_pedido'];
  const ultimo = recompra?.ultimo_pedido ? ` · último ${fmtData(recompra.ultimo_pedido)}` : '';
  // Frequência efetiva vem da view; se calculada do histórico, sinalizar.
  const freq = recompra?.frequencia
    ? `a cada ${recompra.frequencia} dias${recompra.compras >= 2 ? ' (calculado)' : ' (estimado)'}`
    : 'ritmo a definir';
  const ultimaVenda = recompra?.ultimo_valor != null ? ` · última ${fmtMoney(recompra.ultimo_valor)}` : '';
  const perdido = estaPerdido(cliente, recompra?.ultimo_pedido);
  return el('div', { class: 'list-item' },
    el('div', { class: 'info', style: 'cursor:pointer', onclick: () => onDetalhe(cliente) },
      el('div', { class: 'title' }, cliente.nome),
      el('div', { class: 'sub' }, `${freq}${ultimo}${ultimaVenda}${cliente.dose ? ` · ${cliente.dose}` : ''}`),
      el('div', { class: 'badges' },
        tagFiltravel(el('span', { class: `badge ${cls}` }, label),
          { tipo: 'status', valor: recompra?.status || 'sem_pedido', rotulo: label }, onTag),
        tagFiltravel(badgeOrigem(cliente.origem),
          { tipo: 'origem', valor: cliente.origem, rotulo: rotuloOrigem[cliente.origem] || cliente.origem }, onTag),
        tagFiltravel(badgeFormaPagamento(cliente.forma_pagamento),
          { tipo: 'pagamento', valor: cliente.forma_pagamento, rotulo: rotuloPagamento[cliente.forma_pagamento] || cliente.forma_pagamento }, onTag),
        perdido
          ? tagFiltravel(el('span', { class: 'badge badge-red' }, 'Perdido'),
              { tipo: 'perdido', rotulo: 'Perdido' }, onTag)
          : null)),
    el('div', { class: 'actions' },
      botaoWhatsApp(cliente.nome, cliente.contato),
      el('button', { class: 'btn btn-outline btn-sm', onclick: () => onEdit(cliente) }, 'Editar')));
}

// ---- Detalhe do cliente (histórico completo) ----
const badgePag = {
  pago: ['badge-green', 'Pago'], parcial: ['badge-yellow', 'Parcial'], pendente: ['badge-red', 'Pendente'],
};
const badgeEnt = {
  entregue: ['badge-green', 'Entregue'], separado: ['badge-yellow', 'Separado'], aguardando: ['badge-gray', 'Aguardando'],
};

function itemHistorico(p) {
  const [clsP, labP] = badgePag[p.pagamento] || ['badge-gray', p.pagamento];
  const [clsE, labE] = badgeEnt[p.entrega] || ['badge-gray', p.entrega];
  const lote = p.lote ? ` · ${p.lote.referencia || `lote ${fmtData(p.lote.data)}`}` : '';
  return el('div', { class: 'list-item', style: 'padding:10px' },
    el('div', { class: 'info' },
      el('div', { class: 'title', style: 'font-size:14px' }, `${fmtData(p.data)} · ${p.qtd} un · ${fmtMoney(p.valor)}`),
      el('div', { class: 'sub' }, `${p.dose ? `${p.dose}` : 'sem dose anotada'}${lote}`),
      el('div', { class: 'badges' },
        el('span', { class: `badge ${clsP}` }, labP),
        el('span', { class: `badge ${clsE}` }, labE))));
}

// Registrado por initClientes — permite Editar a partir de qualquer tela.
let abrirModalClienteRef = null;

export async function abrirDetalheCliente(cliente, { onEditar, onChanged } = {}) {
  const corpo = document.getElementById('detalhe-corpo');
  openModal('modal-detalhe');
  loadingState(corpo);
  try {
    const [{ data: pedidos, error }, recompra] = await Promise.all([
      db.from('pedidos')
        .select('*, lote:compra_id(referencia, data)')
        .eq('cliente_id', cliente.id).eq('is_active', true)
        .order('data', { ascending: false }),
      recompraPorCliente(),
    ]);
    if (error) throw new Error(error.message);
    const r = recompra.find((x) => x.cliente_id === cliente.id);
    const [cls, label] = badgeStatus[r?.status || 'sem_pedido'];
    const perdido = estaPerdido(cliente, r?.ultimo_pedido);
    const total = pedidos.reduce((s, p) => s + Number(p.valor), 0);

    const aposMudanca = () => {
      closeModal('modal-detalhe');
      onChanged?.();
    };
    const btnPerdido = perdido
      ? el('button', {
          class: 'btn btn-outline btn-sm',
          onclick: async () => { await retomarCliente(cliente.id); toast('De volta ao funil.'); aposMudanca(); },
        }, 'Retomar')
      : el('button', {
          class: 'btn btn-outline btn-sm',
          onclick: async () => {
            if (!await confirmar(`${cliente.nome} não quer agora? Ele sai dos alertas e fica ${PERDIDO_DIAS_VISIVEL} dias no Perdido.`, { rotulo: 'Perdido' })) return;
            await marcarPerdido(cliente.id);
            toast('Marcado como perdido.');
            aposMudanca();
          },
        }, 'Perdido');

    renderInto(corpo, [
      el('div', { class: 'modal-title', style: 'margin-bottom:4px' }, cliente.nome),
      el('div', { class: 'sub', style: 'color:var(--text-muted); font-size:13px' },
        `${cliente.contato}${r?.frequencia ? ` · a cada ${r.frequencia} dias` : ''}${cliente.dose ? ` · ${cliente.dose}` : ''}`),
      el('div', { class: 'badges', style: 'display:flex; gap:6px; margin:10px 0 14px; flex-wrap:wrap' },
        el('span', { class: `badge ${cls}` }, label),
        badgeOrigem(cliente.origem),
        badgeFormaPagamento(cliente.forma_pagamento),
        perdido ? el('span', { class: 'badge badge-red' }, `Perdido em ${fmtData(cliente.perdido_em)}`) : null),
      typeof cliente.anotacao === 'string' && cliente.anotacao.trim() && cliente.anotacao !== 'null'
        ? el('div', {
            class: 'card',
            style: 'padding:10px 12px; font-size:13px; color:var(--text-muted); margin-bottom:14px',
          }, cliente.anotacao)
        : null,
      el('div', { class: 'summary-grid' },
        el('div', { class: 'summary-card' },
          el('div', { class: 'label' }, 'Compras'), el('div', { class: 'value' }, pedidos.length)),
        el('div', { class: 'summary-card' },
          el('div', { class: 'label' }, 'Total comprado'), el('div', { class: 'value' }, fmtMoney(total))),
        el('div', { class: 'summary-card' },
          el('div', { class: 'label' }, 'Última venda'),
          el('div', { class: 'value', style: 'color: var(--primary)' },
            r?.ultimo_valor != null ? fmtMoney(r.ultimo_valor) : '—')),
        el('div', { class: 'summary-card' },
          el('div', { class: 'label' }, 'Negociação atual'),
          el('div', { class: 'value', style: 'color: var(--warning)' },
            cliente.valor_negociacao != null ? fmtMoney(cliente.valor_negociacao) : '—'))),
      el('div', { style: 'display:flex; gap:8px; margin-bottom:16px' },
        botaoWhatsApp(cliente.nome, cliente.contato),
        (() => {
          const editar = onEditar || abrirModalClienteRef;
          return editar
            ? el('button', {
                class: 'btn btn-outline btn-sm',
                onclick: () => { closeModal('modal-detalhe'); editar(cliente); },
              }, 'Editar')
            : null;
        })(),
        btnPerdido),
      el('div', { class: 'section-title', style: 'margin-top:0' }, 'Histórico de pedidos'),
      pedidos.length
        ? el('div', {}, pedidos.map(itemHistorico))
        : el('div', { class: 'empty' }, el('div', { class: 'icon' }, '🧾'), el('div', {}, 'Nenhum pedido ainda.')),
    ]);
  } catch {
    errorState(corpo);
  }
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
    origem: document.getElementById('cliente-origem'),
    formaPagamento: document.getElementById('cliente-forma-pagamento'),
    anotacao: document.getElementById('cliente-anotacao'),
    valorNegociacao: document.getElementById('cliente-valor-negociacao'),
  };
  const btnRemover = document.getElementById('btn-remover-cliente');
  const filtroEl = document.getElementById('filtro-clientes');
  let cache = { clientes: [], recompra: new Map() };
  let filtroTag = null; // { tipo: status|origem|perdido, valor, rotulo }

  function abrirModal(cliente) {
    form.reset();
    campos.id.value = cliente?.id || '';
    campos.nome.value = cliente?.nome || '';
    campos.contato.value = cliente?.contato || '';
    campos.frequencia.value = cliente?.frequencia ?? '';
    campos.dose.value = cliente?.dose || '';
    campos.origem.value = cliente?.origem || '';
    campos.formaPagamento.value = cliente?.forma_pagamento || '';
    campos.anotacao.value = cliente?.anotacao || '';
    campos.valorNegociacao.value = cliente?.valor_negociacao ?? '';
    document.getElementById('modal-cliente-titulo').textContent = cliente ? 'Editar cliente' : 'Novo cliente';
    btnRemover.classList.toggle('hidden', !cliente);
    openModal('modal-cliente');
  }

  function aplicarFiltroTag(c) {
    if (!filtroTag) return true;
    const r = cache.recompra.get(c.id);
    if (filtroTag.tipo === 'origem') return c.origem === filtroTag.valor;
    if (filtroTag.tipo === 'pagamento') return c.forma_pagamento === filtroTag.valor;
    if (filtroTag.tipo === 'perdido') return estaPerdido(c, r?.ultimo_pedido);
    return (r?.status || 'sem_pedido') === filtroTag.valor;
  }

  function renderChipFiltro() {
    renderInto(filtroEl, filtroTag
      ? [el('button', {
          class: 'tab active',
          onclick: () => { filtroTag = null; render(); },
        }, `${filtroTag.rotulo} ✕`)]
      : []);
  }

  function render() {
    renderChipFiltro();
    const termo = busca.value.trim().toLowerCase();
    const filtrados = cache.clientes
      .filter((c) => c.nome.toLowerCase().includes(termo))
      .filter(aplicarFiltroTag);
    if (!filtrados.length) {
      return emptyState(container, '👤', termo || filtroTag ? 'Nenhum cliente nesse filtro.' : 'Nenhum cliente ainda. Toque em + para cadastrar.');
    }
    renderInto(container, filtrados.map((c) => itemCliente(
      c, cache.recompra.get(c.id), abrirModal,
      (cli) => abrirDetalheCliente(cli, { onEditar: abrirModal, onChanged: refresh }),
      (filtro) => { filtroTag = filtro; render(); },
    )));
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

  abrirModalClienteRef = abrirModal;
  busca.addEventListener('input', render);

  // Normaliza ao colar/digitar (e de novo ao salvar, por garantia).
  campos.contato.addEventListener('input', () => {
    const normalizado = normalizarContato(campos.contato.value);
    if (campos.contato.value !== normalizado) campos.contato.value = normalizado;
  });
  document.getElementById('btn-novo-cliente').addEventListener('click', () => abrirModal(null));

  submitOnce(form, async () => {
    try {
      await salvarCliente({
        id: campos.id.value || undefined,
        nome: campos.nome.value.trim(),
        contato: normalizarContato(campos.contato.value),
        frequencia: campos.frequencia.value ? Number(campos.frequencia.value) : null,
        dose: campos.dose.value.trim() || null,
        origem: campos.origem.value || null,
        forma_pagamento: campos.formaPagamento.value || null,
        anotacao: campos.anotacao.value.trim() || null,
        valor_negociacao: campos.valorNegociacao.value ? Number(campos.valorNegociacao.value) : null,
      });
      closeModal('modal-cliente');
      toast('Salvo.');
      refresh();
    } catch {
      toast('Não consegui salvar. Confere a conexão e tenta de novo.');
    }
  });

  onClickOnce(btnRemover, async () => {
    if (!await confirmar(`Remover ${campos.nome.value}? Ele sai das listas, mas o histórico continua.`, { rotulo: 'Remover' })) return;
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
