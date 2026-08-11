// chart.js — gráfico de tendência mensal (SVG nativo, sem lib externa).
// Barras de receita + linha de lucro sobre o mesmo eixo, escala pelo maior
// valor absoluto entre as duas séries pra caber lucro negativo no mesmo SVG.

import { el } from './ui.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// document.createElement() não serve pra tags SVG (viram HTMLUnknownElement,
// não renderizam) — precisa de createElementNS com o namespace do SVG.
function elSVG(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const rotuloMes = (iso) => {
  const [ano, mes] = iso.split('-').map(Number);
  return `${MESES[mes - 1]}/${String(ano).slice(2)}`;
};

// pontos: [{mes: 'YYYY-MM-DD', receita, lucro}], mais antigo primeiro.
export function graficoTendencia(pontos, { width = 320, height = 160 } = {}) {
  if (!pontos.length) {
    return el('div', { class: 'empty' }, el('div', {}, 'Sem histórico ainda.'));
  }
  const margemBase = 22; // espaço pros rótulos de mês
  const margemTopo = 10;
  const alturaUtil = height - margemBase - margemTopo;
  const maxAbs = Math.max(1, ...pontos.map((p) => Math.max(Math.abs(p.receita), Math.abs(p.lucro))));
  const zeroY = margemTopo + alturaUtil / 2;
  const escala = (v) => (v / maxAbs) * (alturaUtil / 2);

  const n = pontos.length;
  const passo = width / n;
  const largBarra = Math.min(28, passo * 0.5);

  const barras = pontos.map((p, i) => {
    const cx = passo * i + passo / 2;
    const h = Math.abs(escala(p.receita));
    const y = p.receita >= 0 ? zeroY - h : zeroY;
    return elSVG('rect', {
      x: cx - largBarra / 2, y, width: largBarra, height: Math.max(h, 1),
      fill: 'var(--primary)', opacity: '0.35', rx: '3',
    });
  });

  const pontosLinha = pontos.map((p, i) => {
    const cx = passo * i + passo / 2;
    const cy = zeroY - escala(p.lucro);
    return [cx, cy];
  });
  const linha = elSVG('polyline', {
    points: pontosLinha.map(([x, y]) => `${x},${y}`).join(' '),
    fill: 'none', stroke: 'var(--success)', 'stroke-width': '2',
  });
  const bolinhas = pontosLinha.map(([x, y], i) => elSVG('circle', {
    cx: x, cy: y, r: '3', fill: pontos[i].lucro >= 0 ? 'var(--success)' : 'var(--danger)',
  }));

  const eixoZero = elSVG('line', {
    x1: 0, y1: zeroY, x2: width, y2: zeroY, stroke: 'var(--border)', 'stroke-width': '1',
  });

  const rotulos = pontos.map((p, i) => elSVG('text', {
    x: passo * i + passo / 2, y: height - 4, 'text-anchor': 'middle',
    'font-size': '9', fill: 'var(--text-muted)',
  }, rotuloMes(p.mes)));

  const svg = elSVG('svg', { width: '100%', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Tendência mensal de receita e lucro' },
    eixoZero, ...barras, linha, ...bolinhas, ...rotulos);

  const legenda = el('div', { class: 'chart-legenda' },
    el('span', {}, el('span', { class: 'chart-swatch', style: 'background:var(--primary); opacity:.5' }), 'Receita'),
    el('span', {}, el('span', { class: 'chart-swatch', style: 'background:var(--success)' }), 'Lucro'));

  return el('div', { class: 'chart-wrap' }, svg, legenda);
}
