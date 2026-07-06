// inicio.js — dashboard: KPIs e funil de vendas (kanban).
// Compõe dados de clientes.js, pedidos.js, compras.js e financeiro.js.
// Funil: fases derivadas do último pedido + status de recompra
// (business-rules.md §6) — nenhum estado extra é persistido. A antiga
// lista "acionar nos próximos 10 dias" saiu: a retomada vive no funil
// (coluna Follow-up + retomada automática pra Não iniciada).

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
  el, renderInto, loadingState, errorState, fmtMoney, fmtData,
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

// Retomadas do ciclo atual: cada volta ao Follow-up insere uma linha em
// followups (ativa, cancelada ou enviada — todas contam como acionamento).
// Ciclo = desde o último pedido; sem pedido, desde o cadastro.
async function todosFollowups() {
  const { data, error } = await db.from('followups').select('cliente_id, created_at');
  if (error) throw new Error(error.message);
  return data;
}

function contarRetomadas(followups, ultimoPedidoMap) {
  const mapa = new Map();
  for (const f of followups) {
    const p = ultimoPedidoMap.get(f.cliente_id);
    if (p && f.created_at.slice(0, 10) < p.data) continue; // ciclo anterior, já fechado
    mapa.set(f.cliente_id, (mapa.get(f.cliente_id) || 0) + 1);
  }
  return mapa;
}

// ---- Funil (kanban) ----
// Ordem de decisão por cliente: perdido > pedido em aberto > retomada por
// recompra > descanso em "entregue". Cliente sem pedido = topo do funil.
// Perdido fica visível por PERDIDO_DIAS_VISIVEL dias e some do funil
// (e dos alertas) até novo pedido ou retomada manual.
// Nada a receber deste pedido: pago de verdade ou brinde (bonificado, valor 0).
const quitado = (p) => p.pagamento === 'pago' || p.pagamento === 'bonificado';

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
    } else if (!quitado(p)) {
      fases.pendente.push({ c, p, sub: `${fmtMoney(p.valor)} · pedido de ${fmtData(p.data)}` });
    } else if (p.entrega !== 'entregue') {
      fases.pago.push({
        c,
        p,
        sub: p.pagamento === 'bonificado'
          ? 'bonificado, separar/entregar'
          : `${fmtMoney(p.valor)} · pago, separar/entregar`,
      });
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
      // Voltar pro follow-up com pedido em aberto = estornar a venda:
      // pendente não é receita e o estoque precisa voltar ao lote.
      const desfazPedido = p && (de === 'pendente' || de === 'pago');
      if (desfazPedido) {
        const aviso = de === 'pago'
          ? `Voltar ${c.nome} pro follow-up desfaz a venda paga (o pedido some e o estoque volta ao lote). Continuar?`
          : `Voltar ${c.nome} pro follow-up remove o pedido em aberto (o estoque volta ao lote). Continuar?`;
        if (!await confirmar(aviso, { rotulo: 'Remover pedido' })) return;
      }
      if (de === 'perdido') await retomarCliente(c.id);
      // agendarFollowup (no save do modal) já cancela o pendente anterior.
      // O pedido só é removido DEPOIS do follow-up salvo — abandonar o
      // modal não pode apagar a venda em silêncio.
      abrirModalFollowup(c, !desfazPedido ? onChanged : async () => {
        try {
          await removerPedido({ id: p.id, compra_id: p.compra_id, qtd: p.qtd });
        } catch (err) {
          toast(`Follow-up salvo, mas não consegui remover o pedido: ${err.message}`);
        }
        onChanged();
      });
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
      // entregar um brinde não o transforma em venda paga
      if (p.pagamento !== 'bonificado') patch.pagamento = 'pago';
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

// ---- Modo mover (touch) ----
// Arrastar segurando brigava com a rolagem no iOS (pointercancel, callout,
// sem como rolar com o card preso). Padrão novo: segurar PEGA o card, a
// rolagem continua 100% livre, e tocar na fase de destino solta. Banner
// fixo mostra o que está sendo movido, com Cancelar.
let modoMover = null; // { item, fase, onChanged }
let bannerMover = null;
let ignorarCliquePosPegar = false;

function sairModoMover() {
  modoMover = null;
  bannerMover?.remove();
  bannerMover = null;
  document.querySelectorAll('.kanban-card.movendo').forEach((c) => c.classList.remove('movendo'));
  document.getElementById('funil')?.classList.remove('escolhendo');
}

function entrarModoMover(card, item, fase, onChanged) {
  sairModoMover();
  modoMover = { item, fase, onChanged };
  card.classList.add('movendo');
  document.getElementById('funil')?.classList.add('escolhendo');
  navigator.vibrate?.(15);
  // o clique disparado ao soltar o dedo do long-press não é uma escolha
  ignorarCliquePosPegar = true;
  document.addEventListener('pointerup', () => {
    setTimeout(() => { ignorarCliquePosPegar = false; }, 350);
  }, { once: true });
  bannerMover = el('div', { class: 'mover-banner' },
    el('div', {}, `Movendo ${item.c.nome} — toque na fase de destino`),
    el('button', { class: 'btn btn-outline btn-sm', onclick: sairModoMover }, 'Cancelar'));
  document.body.append(bannerMover);
}

// Chamado pela coluna (fase de captura) quando há um card "pego".
function concluirModoMover(faseDestino) {
  const { item, fase, onChanged } = modoMover;
  sairModoMover();
  if (faseDestino !== fase) moverCard(item, fase, faseDestino, onChanged);
}

// Mouse: arrasto direto com ghost (desktop). Touch: long-press entra no
// modo mover acima — nenhum preventDefault de rolagem envolvido.
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

  // Janela estreita com mouse: kanban ainda rola — borda rola sozinha.
  const autoScroll = () => {
    if (!arrastando) return;
    const kanban = card.closest('.kanban');
    if (kanban) {
      const r = kanban.getBoundingClientRect();
      const zona = 56;
      if (px > r.right - zona) kanban.scrollLeft += 14;
      else if (px < r.left + zona) kanban.scrollLeft -= 14;
      atualizarAlvo(px, py);
    }
    raf = requestAnimationFrame(autoScroll);
  };

  card.addEventListener('contextmenu', (e) => {
    if (arrastando || timer || modoMover) e.preventDefault();
  });

  const levantar = (pointerId) => {
    arrastando = true;
    try { card.setPointerCapture(pointerId); } catch { /* segue sem captura */ }
    const r = card.getBoundingClientRect();
    ghost = card.cloneNode(true);
    Object.assign(ghost.style, {
      position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`,
      zIndex: 300, opacity: .92, pointerEvents: 'none', transform: 'rotate(2deg)',
      boxShadow: '0 8px 24px rgba(0,0,0,.35)',
    });
    document.body.append(ghost);
    card.style.opacity = .35;
    raf = requestAnimationFrame(autoScroll);
  };

  card.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    sx = e.clientX;
    sy = e.clientY;
    if (e.pointerType === 'touch') {
      if (modoMover) return; // já tem card pego — o toque é escolha de destino
      timer = setTimeout(() => entrarModoMover(card, item, fase, onChanged), 250);
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
        // touch: moveu antes do long-press = rolagem, não pegar
        clearTimeout(timer);
        timer = null;
      }
      if (!arrastando) return;
    }
    ghost.style.left = `${e.clientX - ghost.offsetWidth / 2}px`;
    ghost.style.top = `${e.clientY - 20}px`;
    atualizarAlvo(e.clientX, e.clientY);
  });

  const soltar = (aplicar) => {
    const estava = arrastando;
    arrastando = false;
    armado = null;
    limpar();
    if (estava) {
      card.dataset.arrastou = '1'; // suprime o clique que fecha o gesto
      setTimeout(() => delete card.dataset.arrastou, 300);
      if (aplicar && alvo && alvo !== fase) moverCard(item, fase, alvo, onChanged);
    }
    alvo = null;
  };
  card.addEventListener('pointerup', () => soltar(true));
  card.addEventListener('pointercancel', () => soltar(false));
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
  const badges = [];
  const freq = recompraAtual.get(c.id)?.frequencia;
  if (freq) badges.push(el('span', { class: 'badge badge-gray' }, `a cada ${freq} dias`));
  // quantas vezes o card voltou pro follow-up neste ciclo (1ª vez não é "voltar")
  const retomadas = fase === 'followup' ? retomadasAtual.get(c.id) || 0 : 0;
  if (retomadas >= 2) badges.push(el('span', { class: 'badge badge-yellow' }, `×${retomadas}`));
  const card = el('div', { class: 'kanban-card', style: 'cursor:grab' },
    el('div', { class: 'title' }, c.nome),
    el('div', { class: 'sub' }, sub),
    badges.length ? el('div', { class: 'badges' }, badges) : null,
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

// "Hoje"/"Amanhã"/data — cabeçalho dos grupos de data da coluna Follow-up,
// pra enxergar como a fila de mensagens vai se comportar.
function rotuloDataFollowup(dataISO) {
  const dias = diffDias(parseDateLocal(dataISO), hojeLocal());
  if (dias < 0) return { rotulo: `Atrasado · ${fmtData(dataISO)}`, atrasado: true };
  if (dias === 0) return { rotulo: 'Hoje', atrasado: false };
  if (dias === 1) return { rotulo: 'Amanhã', atrasado: false };
  return { rotulo: fmtData(dataISO), atrasado: false };
}

function colunaFunil(titulo, fase, cards, onChanged) {
  const filhos = [];
  let dataAnterior = null;
  for (const item of cards) {
    if (fase === 'followup' && item.data && item.data !== dataAnterior) {
      dataAnterior = item.data;
      const { rotulo, atrasado } = rotuloDataFollowup(item.data);
      filhos.push(el('div', { class: `col-subheader${atrasado ? ' atrasado' : ''}` }, rotulo));
    }
    filhos.push(cardFunil(item, fase, onChanged));
  }
  const col = el('div', { class: 'kanban-col', 'data-fase': fase },
    el('div', { class: 'col-title' }, titulo, el('span', { class: 'count' }, cards.length)),
    filhos.length ? filhos : el('div', { class: 'vazio' }, '—'));
  // Com card pego, QUALQUER toque na coluna (título, card, vazio) é escolha
  // de destino — captura impede o clique de abrir detalhe/ações.
  col.addEventListener('click', (e) => {
    if (!modoMover) return;
    e.stopPropagation();
    e.preventDefault();
    if (ignorarCliquePosPegar) return;
    concluirModoMover(fase);
  }, true);
  return col;
}

// Fase atual e item de cada cliente no funil — atualizado a cada refresh;
// usado pelo "Mover no funil" do detalhe do cliente.
let indiceFunil = new Map();
let ultimoPedidoAtual = new Map();
let recompraAtual = new Map(); // badge de frequência nos cards
let retomadasAtual = new Map(); // ×N de voltas ao follow-up no ciclo

export function initInicio() {
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
    sairModoMover(); // re-render invalida o card pego
    loadingState(funilEl);
    try {
      const [clientes, pedidos, recompra, followups, estoque, cons, historicoFups] = await Promise.all([
        listarClientes(), listarPedidos(), recompraPorCliente(), followupsPendentes(),
        estoqueLivre(), consolidado(), todosFollowups(),
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
      recompraAtual = recompraMap;
      retomadasAtual = contarRetomadas(historicoFups, ultimoPedidoMap);
      renderInto(funilEl, [
        colunaFunil('Não iniciada', 'nao_iniciada', fases.nao_iniciada, refresh),
        colunaFunil('Follow-up', 'followup', fases.followup, refresh),
        colunaFunil('Pendente pagamento', 'pendente', fases.pendente, refresh),
        colunaFunil('Pago', 'pago', fases.pago, refresh),
        colunaFunil('Entregue medicação', 'entregue', fases.entregue, refresh),
        colunaFunil('Perdido', 'perdido', fases.perdido, refresh),
      ]);

    } catch {
      errorState(funilEl);
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
