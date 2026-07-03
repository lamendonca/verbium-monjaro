// ui.js — helpers de apresentação compartilhados pelos módulos de tela.
// Sem acesso ao banco (isso é papel do db.js). Render sempre via textContent
// para dado vindo do banco — nunca innerHTML de dado cru (security.md).

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtMoney = (v) => brl.format(Number(v) || 0);

// Datas de negócio são DATE ('YYYY-MM-DD') comparadas no fuso LOCAL do
// dispositivo — não usar new Date(iso) direto (interpreta como UTC, erro ±1 dia).
export function parseDateLocal(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function hojeLocal() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

export function hojeISO() {
  const h = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${h.getFullYear()}-${p(h.getMonth() + 1)}-${p(h.getDate())}`;
}

export const fmtData = (iso) => {
  const d = parseDateLocal(iso);
  return d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}` : '—';
};

export const diffDias = (a, b) => Math.round((a - b) / 86400000);

// Construtor de DOM seguro: texto sempre via textContent.
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'disabled') node.disabled = !!v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function renderInto(container, nodes) {
  container.replaceChildren(...[].concat(nodes));
}

export function loadingState(container, msg = 'Carregando...') {
  renderInto(container, el('div', { class: 'loading' }, msg));
}

export function emptyState(container, icon, msg) {
  renderInto(container, el('div', { class: 'empty' }, el('div', { class: 'icon' }, icon), el('div', {}, msg)));
}

export function errorState(container) {
  renderInto(container, el('div', { class: 'error-msg' }, 'Não consegui falar com o banco. Confere a conexão e tenta de novo.'));
}

// ---- Modais slide-up ----
export function openModal(id) {
  document.getElementById(id).classList.add('open');
}
export function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
// Fechar tocando no overlay (fora do modal).
document.addEventListener('click', (e) => {
  if (e.target.classList?.contains('modal-overlay')) e.target.classList.remove('open');
});

// ---- Toast curto ("Salvo.") ----
export function toast(msg) {
  const t = el('div', { class: 'card' }, msg);
  Object.assign(t.style, {
    position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%)',
    zIndex: 200, padding: '10px 18px', fontSize: '14px',
  });
  document.body.append(t);
  setTimeout(() => t.remove(), 2000);
}
