// inicio.js — dashboard: KPIs, funil de vendas (kanban) e alertas de recompra.
// Compõe dados de clientes.js, pedidos.js, compras.js e financeiro.js.
// Funil: fases derivadas do último pedido + status de recompra
// (business-rules.md §8) — nenhum estado extra é persistido.

import {
  listarClientes, recompraPorCliente, botaoWhatsApp, abrirDetalheCliente,
  estaPerdido, marcarPerdido, retomarCliente, marcarNegociacao, PERDIDO_DIAS_VISIVEL,
  cancelarFollowupsPendentes, registrarMoverFase,
} from './clientes.js';
import { listarPedidos, novoPedidoParaCliente, removerPedido } from './pedidos.js';
import { estoqueLivre } from './compras.js';
import { consolidado } from './financeiro.js';
import { db, update, insert } from './db.js';
import {
  el, renderInto, loadingState, emptyState, errorState, fmtMoney, fmtData,
  parseDateLocal, hojeLocal, diffDias, hojeISO, toast, openModal, closeModal,
  submitOnce, confirmar,
} from './ui.js';

// ---- Follow-up (mensagem automática via Evolution — business-rules.md §6) ----
async function followupsPendentes() {
  const { data, error } = await db.from('followups')
    .select('*').eq('is_active', true).is('enviado_em', null);
  if (error) throw new Error(error.message);
  return data;
}

async function agendarFollowup(clienteId, data, mensagem) {
  await cancelarFollowupsPendentes(clienteId); // um pendente por cliente
  return insert('followups', { cliente_id: clienteId, data, mensagem });
}

// Modal preenchido/aberto pelo arrasto; submit é ligado uma vez no init.
let followupOnSave = null;
function abrirModalFollowup(cliente, onSave) {
  document.getElementById('followup-cliente').value = cliente.id;
  document.getElementById('followup-data').value = hojeISO();
  document.getElementById('followup-mensagem').value =
    `Oi ${cliente.nome}! Passando pra ver se você já vai querer repor o Mounjaro. 😊`;
  followupOnSave = onSave || null;
  openModal('modal-followup');
}

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
// Ordem de decisão por cliente: perdido > pedido em aberto > retomada por
// recompra > descanso em "entregue". Cliente sem pedido = topo do funil.
// Perdido fica visível por PERDIDO_DIAS_VISIVEL dias e some do funil
// (e dos alertas) até novo pedido ou retomada manual.
function montarFunil(clientes, recompraMap, ultimoPedidoMap, followupMap) {
  const fases = { nao_iniciada: [], followup: [], pendente: [], pago: [], entregue: [], perdido: [] };
  for (const c of clientes) {
    const r = recompraMap.get(c.id);
    const p = ultimoPedidoMap.get(c.id);
    const f = followupMap.get(c.id);
    // preço de referência pra negociar: o combinado agora > a última venda
    const referencia = c.valor_negociacao != null
      ? ` · negociando ${fmtMoney(c.valor_negociacao)}`
      : (r?.ultimo_valor != null ? ` · última ${fmtMoney(r.ultimo_valor)}` : '');
    if (estaPerdido(c, r?.ultimo_pedido)) {
      const dias = diffDias(hojeLocal(), parseDateLocal(c.perdido_em));
      if (dias <= PERDIDO_DIAS_VISIVEL) {
        fases.perdido.push({ c, p, sub: `não quis em ${fmtData(c.perdido_em)}`, retomar: true });
      }
    } else if (f) {
      fases.followup.push({ c, p, f, sub: `mensagem em ${fmtData(f.data)}`, data: f.data });
    } else if (!p) {
      fases.nao_iniciada.push({ c, sub: `novo — em negociação${referencia}`, urgencia: 1 });
    } else if (p.pagamento !== 'pago') {
      fases.pendente.push({ c, p, sub: `${fmtMoney(p.valor)} · pedido de ${fmtData(p.data)}` });
    } else if (p.entrega !== 'entregue') {
      fases.pago.push({ c, p, sub: `${fmtMoney(p.valor)} · pago, separar/entregar` });
    } else if (c.negociacao_em && c.negociacao_em >= p.data) {
      // retomada manual (arrasto): em negociação até sair novo pedido
      fases.nao_iniciada.push({ c, sub: `em negociação${referencia}`, urgencia: 1, whatsapp: true });
    } else if (r?.status === 'atrasado' || r?.status === 'alerta') {
      const quando = r.status === 'atrasado'
        ? `recompra atrasada há ${Math.abs(r.dias_restantes)} dia(s)`
        : `recompra em ${r.dias_restantes} dia(s)`;
      // sem `p`: arrastar pra uma fase de pedido abre um pedido NOVO (novo ciclo)
      fases.nao_iniciada.push({ c, sub: `${quando}${referencia}`, urgencia: r.status === 'atrasado' ? 0 : 2, whatsapp: true });
    } else {
      fases.entregue.push({ c, p, sub: `entregue em ${fmtData(p.data)}`, data: p.data });
    }
  }
  fases.nao_iniciada.sort((a, b) => (a.urgencia ?? 9) - (b.urgencia ?? 9));
  fases.followup.sort((a, b) => (a.data || '').localeCompare(b.data || ''));
  fases.entregue.sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  return fases;
}

// ---- Mover card (arrasto entre fases) ----
// Cada movimento grava a mudança correspondente nos dados; movimentos sem
// significado são recusados com aviso.
async function moverCard(item, de, para, onChanged) {
  const { c, p } = item;
  try {
    // Sair do Follow-up cancela a mensagem agendada — mas só DEPOIS do
    // movimento se concretizar: recusar um confirm ou abandonar o modal
    // não pode apagar um follow-up agendado em silêncio.
    if (para === 'followup') {
      if (de === 'perdido') await retomarCliente(c.id);
      // agendarFollowup (no save do modal) já cancela o pendente anterior
      abrirModalFollowup(c, onChanged);
      return;
    }
    if (para === 'perdido') {
      if (!await confirmar(`Marcar ${c.nome} como perdido? Ele sai dos alertas por enquanto.`, { rotulo: 'Perdido' })) return;
      await cancelarFollowupsPendentes(c.id);
      await marcarPerdido(c.id);
      toast('Marcado como perdido.');
      return onChanged();
    }
    if (para === 'nao_iniciada') {
      if (de === 'perdido') {
        await retomarCliente(c.id);
      } else if (p && (de === 'pendente' || de === 'pago')) {
        // voltar pra negociação com pedido em aberto = cancelar o pedido
        if (!await confirmar(`Voltar ${c.nome} pra negociação remove o pedido em aberto (o estoque volta ao lote). Continuar?`, { rotulo: 'Remover pedido' })) return;
        await removerPedido({ id: p.id, compra_id: p.compra_id, qtd: p.qtd });
        await marcarNegociacao(c.id);
      } else {
        await marcarNegociacao(c.id);
      }
      if (de === 'followup') await cancelarFollowupsPendentes(c.id);
      toast('Em negociação.');
      return onChanged();
    }
    // Destino é fase de pedido. Sem pedido em aberto → novo pedido (novo ciclo).
    if (!p) {
      if (de === 'perdido') await retomarCliente(c.id);
      return novoPedidoParaCliente(c.id, {
        pagamento: para === 'pendente' ? 'pendente' : 'pago',
        entrega: para === 'entregue' ? 'entregue' : 'aguardando',
        onSave: async () => {
          if (de === 'followup') await cancelarFollowupsPendentes(c.id);
          onChanged();
        },
      });
    }
    const patch = {};
    if (para === 'pendente') patch.pagamento = 'pendente';
    if (para === 'pago') {
      patch.pagamento = 'pago';
      if (p.entrega === 'entregue') patch.entrega = 'separado'; // voltando da entrega
    }
    if (para === 'entregue') {
      patch.pagamento = 'pago';
      patch.entrega = 'entregue';
    }
    await update('pedidos', p.id, patch);
    if (de === 'followup') await cancelarFollowupsPendentes(c.id);
    toast('Movido.');
    onChanged();
  } catch (err) {
    toast(`Não consegui mover: ${err.message}`);
  }
}

// Mouse: arrasta direto (movimento > 5px). Touch: long-press curto (200ms)
// pra não brigar com a rolagem do kanban.
function tornarArrastavel(card, item, fase, onChanged) {
  let timer = null;
  let ghost = null;
  let arrastando = false;
  let armado = null; // pointerdown de mouse aguardando movimento
  let alvo = null;
  let sx = 0;
  let sy = 0;
  let px = 0; // última posição do ponteiro (auto-scroll)
  let py = 0;
  let raf = null;

  const limpar = () => {
    clearTimeout(timer);
    timer = null;
    cancelAnimationFrame(raf);
    raf = null;
    ghost?.remove();
    ghost = null;
    card.style.opacity = '';
    document.querySelectorAll('.kanban-col.drop-alvo').forEach((col) => col.classList.remove('drop-alvo'));
  };

  const atualizarAlvo = (x, y) => {
    const col = document.elementFromPoint(x, y)?.closest('.kanban-col');
    document.querySelectorAll('.kanban-col.drop-alvo').forEach((c2) => c2.classList.remove('drop-alvo'));
    alvo = col?.dataset.fase || null;
    if (col && alvo !== fase) col.classList.add('drop-alvo');
  };

  // No mobile só ~1,5 coluna aparece: sem isto não dá pra alcançar as outras
  // fases arrastando. Card parado na borda rola o kanban sozinho (no desktop
  // em grade, scrollLeft é no-op inofensivo).
  const autoScroll = () => {
    if (!arrastando) return;
    const kanban = card.closest('.kanban');
    if (kanban) {
      const r = kanban.getBoundingClientRect();
      const zona = 56;
      if (px > r.right - zona) kanban.scrollLeft += 14;
      else if (px < r.left + zona) kanban.scrollLeft -= 14;
      atualizarAlvo(px, py); // o scroll muda a coluna sob o dedo
    }
    raf = requestAnimationFrame(autoScroll);
  };

  card.addEventListener('contextmenu', (e) => {
    if (arrastando || timer) e.preventDefault();
  });
  // Non-passive: precisa poder cancelar a rolagem enquanto arrasta (touch).
  card.addEventListener('touchmove', (e) => {
    if (arrastando) e.preventDefault();
  }, { passive: false });

  const levantar = (pointerId) => {
    arrastando = true;
    card.setPointerCapture(pointerId);
    const r = card.getBoundingClientRect();
    ghost = card.cloneNode(true);
    Object.assign(ghost.style, {
      position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`,
      zIndex: 300, opacity: .92, pointerEvents: 'none', transform: 'rotate(2deg)',
      boxShadow: '0 8px 24px rgba(0,0,0,.35)',
    });
    document.body.append(ghost);
    card.style.opacity = .35;
    navigator.vibrate?.(15);
    raf = requestAnimationFrame(autoScroll);
  };

  card.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    sx = e.clientX;
    sy = e.clientY;
    if (e.pointerType === 'touch') {
      timer = setTimeout(() => levantar(e.pointerId), 200);
    } else {
      armado = e.pointerId; // mouse: levanta no primeiro movimento real
    }
  });

  card.addEventListener('pointermove', (e) => {
    px = e.clientX;
    py = e.clientY;
    if (!arrastando) {
      const distancia = Math.hypot(e.clientX - sx, e.clientY - sy);
      if (armado !== null && distancia > 5) {
        levantar(armado);
        armado = null;
      } else if (timer && distancia > 8) {
        // touch: moveu antes do long-press = rolagem, não arrasto
        clearTimeout(timer);
        timer = null;
      }
      if (!arrastando) return;
    }
    ghost.style.left = `${e.clientX - ghost.offsetWidth / 2}px`;
    ghost.style.top = `${e.clientY - 20}px`;
    atualizarAlvo(e.clientX, e.clientY);
  });

  const soltar = () => {
    const estava = arrastando;
    arrastando = false;
    armado = null;
    limpar();
    if (estava) {
      card.dataset.arrastou = '1'; // suprime o clique que fecha o gesto
      setTimeout(() => delete card.dataset.arrastou, 300);
      if (alvo && alvo !== fase) moverCard(item, fase, alvo, onChanged);
    }
    alvo = null;
  };
  card.addEventListener('pointerup', soltar);
  card.addEventListener('pointercancel', soltar);
}

function cardFunil(item, fase, onChanged) {
  const { c, sub, whatsapp, retomar } = item;
  const acoes = [];
  if (whatsapp) acoes.push(botaoWhatsApp(c.nome, c.contato));
  if (retomar) {
    acoes.push(el('button', {
      class: 'btn btn-outline btn-sm',
      onclick: async (e) => {
        e.stopPropagation();
        await retomarCliente(c.id);
        toast('De volta ao funil.');
        onChanged?.();
      },
    }, 'Retomar'));
  }
  const card = el('div', { class: 'kanban-card', style: 'cursor:grab' },
    el('div', { class: 'title' }, c.nome),
    el('div', { class: 'sub' }, sub),
    // stopPropagation: ações não devem abrir o detalhe do cliente junto.
    acoes.length
      ? el('div', { class: 'acao', style: 'display:flex; gap:6px', onclick: (e) => e.stopPropagation() }, acoes)
      : null);
  card.addEventListener('click', () => {
    if (!card.dataset.arrastou) abrirDetalheCliente(c, { onChanged });
  });
  tornarArrastavel(card, item, fase, onChanged);
  return card;
}

function colunaFunil(titulo, fase, cards, onChanged) {
  return el('div', { class: 'kanban-col', 'data-fase': fase },
    el('div', { class: 'col-title' }, titulo, el('span', { class: 'count' }, cards.length)),
    cards.length
      ? cards.map((card) => cardFunil(card, fase, onChanged))
      : el('div', { class: 'vazio' }, '—'));
}

// Fase atual e item de cada cliente no funil — atualizado a cada refresh;
// usado pelo "Mover no funil" do detalhe do cliente.
let indiceFunil = new Map();
let ultimoPedidoAtual = new Map();

export function initInicio() {
  const listaAlertas = document.getElementById('lista-alertas');
  const funilEl = document.getElementById('funil');

  submitOnce(document.getElementById('form-followup'), async () => {
    try {
      await agendarFollowup(
        document.getElementById('followup-cliente').value,
        document.getElementById('followup-data').value,
        document.getElementById('followup-mensagem').value.trim(),
      );
      closeModal('modal-followup');
      toast('Follow-up agendado.');
      followupOnSave?.();
      followupOnSave = null;
    } catch {
      toast('Não consegui agendar. Tenta de novo.');
    }
  });

  async function refresh() {
    loadingState(listaAlertas);
    loadingState(funilEl);
    try {
      const [clientes, pedidos, recompra, followups, estoque, cons] = await Promise.all([
        listarClientes(), listarPedidos(), recompraPorCliente(), followupsPendentes(),
        estoqueLivre(), consolidado(),
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
      const followupMap = new Map(followups.map((f) => [f.cliente_id, f]));
      const fases = montarFunil(clientes, recompraMap, ultimoPedidoMap, followupMap);
      indiceFunil = new Map();
      for (const [faseKey, itens] of Object.entries(fases)) {
        for (const it of itens) indiceFunil.set(it.c.id, { item: it, fase: faseKey });
      }
      ultimoPedidoAtual = ultimoPedidoMap;
      renderInto(funilEl, [
        colunaFunil('Não iniciada', 'nao_iniciada', fases.nao_iniciada, refresh),
        colunaFunil('Follow-up', 'followup', fases.followup, refresh),
        colunaFunil('Pendente pagamento', 'pendente', fases.pendente, refresh),
        colunaFunil('Pago', 'pago', fases.pago, refresh),
        colunaFunil('Entregue medicação', 'entregue', fases.entregue, refresh),
        colunaFunil('Perdido', 'perdido', fases.perdido, refresh),
      ]);

      // Perdidos ficam fora dos alertas até novo pedido ou retomada.
      const clientePorId = new Map(clientes.map((c) => [c.id, c]));
      const avisos = recompra
        .filter((r) => r.status === 'atrasado' || r.status === 'alerta')
        .filter((r) => !estaPerdido(clientePorId.get(r.cliente_id) || {}, r.ultimo_pedido))
        .sort((a, b) => a.proxima_recompra.localeCompare(b.proxima_recompra));
      if (avisos.length) renderInto(listaAlertas, avisos.map(itemAlerta));
      else emptyState(listaAlertas, '🎉', 'Ninguém para acionar nos próximos 10 dias.');
    } catch {
      errorState(funilEl);
      errorState(listaAlertas);
    }
  }

  registrarMoverFase(async (cliente, para) => {
    const atual = indiceFunil.get(cliente.id);
    // fora do funil (ex.: perdido expirado): trata como descanso pós-entrega
    const de = atual?.fase || 'entregue';
    if (de === para) return toast('Já está nessa fase.');
    const item = atual?.item || { c: cliente, p: ultimoPedidoAtual.get(cliente.id) };
    await moverCard(item, de, para, refresh);
  });

  return refresh;
}
