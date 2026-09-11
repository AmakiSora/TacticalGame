/* ══════════ home page ══════════ */

const $ = id => document.getElementById(id);

/* ─── 英雄区装饰棋盘：radius-2 尖顶六角格 ─── */
function renderHeroBoard() {
  const svg = $('hero-board');
  if (!svg) return;
  const NS = 'http://www.w3.org/2000/svg';
  const S = 26;
  const SQRT3 = Math.sqrt(3);
  const center = (q, r) => ({ x: S * SQRT3 * (q + r / 2), y: S * 1.5 * r });
  const hexPoints = (cx, cy) => [
    [cx + 0.866 * S, cy + 0.5 * S], [cx, cy + S], [cx - 0.866 * S, cy + 0.5 * S],
    [cx - 0.866 * S, cy - 0.5 * S], [cx, cy - S], [cx + 0.866 * S, cy - 0.5 * S],
  ].map(p => p.map(n => n.toFixed(2)).join(',')).join(' ');

  const cells = [];
  for (let r = -2; r <= 2; r += 1) {
    for (let q = Math.max(-2, -r - 2); q <= Math.min(2, -r + 2); q += 1) {
      cells.push({ q, r });
    }
  }
  const terrain = {
    '0,-2': 'water', '-1,2': 'water',
    '-1,-1': 'blocker', '1,1': 'blocker',
  };
  const headquarters = { '-2,0': '#66ccff', '2,0': '#ff9966' };
  const controlPoint = '0,0';
  const units = [
    { q: -1, r: 0, color: '#66ccff', shape: 'circle' },
    { q: -1, r: 1, color: '#66ccff', shape: 'diamond' },
    { q: 1, r: -1, color: '#ff9966', shape: 'circle' },
    { q: 1, r: 0, color: '#ff9966', shape: 'square' },
  ];

  const FILLS = {
    plain: { fill: '#1a2a3a', stroke: '#2a4a5a' },
    water: { fill: '#16324a', stroke: '#1f4a6a' },
    blocker: { fill: '#0d1319', stroke: '#1c2833' },
  };

  const frag = document.createDocumentFragment();
  for (const cell of cells) {
    const key = `${cell.q},${cell.r}`;
    const { x, y } = center(cell.q, cell.r);
    const poly = document.createElementNS(NS, 'polygon');
    poly.setAttribute('points', hexPoints(x, y));
    const hq = headquarters[key];
    const kind = terrain[key] || 'plain';
    poly.setAttribute('fill', hq ? 'rgba(80,170,220,.16)' : FILLS[kind].fill);
    if (hq && key === '2,0') poly.setAttribute('fill', 'rgba(230,130,80,.16)');
    poly.setAttribute('stroke', hq || (key === controlPoint ? '#d6b34a' : FILLS[kind].stroke));
    poly.setAttribute('stroke-width', key === controlPoint || hq ? '1.6' : '1');
    frag.appendChild(poly);
    if (key === controlPoint) {
      const ring = document.createElementNS(NS, 'circle');
      ring.setAttribute('cx', x); ring.setAttribute('cy', y); ring.setAttribute('r', 8);
      ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', '#d6b34a'); ring.setAttribute('stroke-width', '2');
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('r', 3);
      dot.setAttribute('fill', '#f0d77c');
      frag.append(ring, dot);
    }
  }
  for (const unit of units) {
    const { x, y } = center(unit.q, unit.r);
    let el;
    if (unit.shape === 'square') {
      el = document.createElementNS(NS, 'rect');
      el.setAttribute('x', x - 6); el.setAttribute('y', y - 6);
      el.setAttribute('width', 12); el.setAttribute('height', 12);
      el.setAttribute('rx', 2);
    } else if (unit.shape === 'diamond') {
      el = document.createElementNS(NS, 'polygon');
      el.setAttribute('points', `${x},${y - 7} ${x + 7},${y} ${x},${y + 7} ${x - 7},${y}`);
    } else {
      el = document.createElementNS(NS, 'circle');
      el.setAttribute('cx', x); el.setAttribute('cy', y); el.setAttribute('r', 7);
    }
    el.setAttribute('fill', unit.color);
    el.setAttribute('stroke', '#0f141c');
    el.setAttribute('stroke-width', '2');
    frag.appendChild(el);
  }
  svg.setAttribute('viewBox', '-118 -110 236 220');
  svg.appendChild(frag);
}

async function loadMaps() {
  try {
    const res = await fetch('/api/maps');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const counter = $('map-count');
    if (counter) counter.textContent = String((data.maps || []).length);
  } catch {
    const counter = $('map-count');
    if (counter) counter.textContent = '–';
  }
}

renderHeroBoard();
loadMaps();
