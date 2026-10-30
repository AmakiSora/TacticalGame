/**
 * arena-charts.js — 零依赖原生 SVG 图表工具（AI 竞技场玩法统计用）。
 *
 * 全部返回 SVG 字符串，适配竞技场深色主题。约定：
 *   - 图表用 viewBox 固定画布，CSS 里 width:100% 做响应式；
 *   - 颜色常量 CHART_COLORS / 语义色（涨=红、跌=绿为股票口径，本页不涉及，用品牌绿+辅助色）；
 *   - 每个函数只做「画」，不做数据归一化；归一化由调用方（arena-stats.js）负责。
 */

export const CHART_COLORS = ['#3f9b6c', '#9ad3e8', '#e8c890', '#c98bd8', '#f0a0a0', '#8ddda4', '#e8a06c', '#7aa6e8'];
const GRID = '#22303a';
const AXIS = '#2a3a44';
const TEXT = '#9ab';
const TEXT_DIM = '#66788a';
const TEXT_BRIGHT = '#dce8f0';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 柱内数值标签字号自动降档：长数字（如 2,888）用小号。 */
function valueLabel(v, x, y, opts = {}) {
  const text = opts.format ? opts.format(v) : String(v);
  const size = text.length > 5 ? 9 : text.length > 3 ? 10 : 11;
  return `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" fill="${opts.color || TEXT_BRIGHT}">${esc(text)}</text>`;
}

/**
 * 垂直柱状图：labels + values（可选 pcts）。用于回合数分布 / 耗时分布 / 决策耗时分布 / 结局原因。
 */
export function barChart({ labels, values, pcts, height = 260, color = CHART_COLORS[0], format, barColors }) {
  const W = 680, H = height;
  const padL = 42, padR = 12, padT = 16, padB = 44;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const n = labels.length;
  if (!n) return '<div class="chart-empty">无数据</div>';
  const max = Math.max(...values, 1);
  const slot = chartW / n;
  const barW = Math.min(50, slot * 0.58);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max);
  let grid = '';
  for (const t of ticks) {
    const y = padT + chartH - (t / max) * chartH;
    grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`;
    grid += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="${TEXT_DIM}">${format ? format(t) : Math.round(t)}</text>`;
  }
  let bars = '';
  labels.forEach((lb, i) => {
    const v = values[i];
    const h = v > 0 ? Math.max(1.5, (v / max) * chartH) : 0;
    const x = padL + slot * i + (slot - barW) / 2;
    const y = padT + chartH - h;
    const c = barColors ? barColors[i] : color;
    const label = lb.length > 6 ? lb.slice(0, 6) : lb;
    bars += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="2" fill="${c}" opacity="0.9"><title>${esc(lb)}：${format ? format(v) : v}</title></rect>`;
    bars += `<text x="${x + barW / 2}" y="${padT + chartH + 14}" text-anchor="middle" font-size="10" fill="${TEXT}">${esc(label)}</text>`;
    if (pcts && pcts[i] != null && v > 0) {
      bars += `<text x="${x + barW / 2}" y="${y - 5}" text-anchor="middle" font-size="9" fill="${TEXT}">${pcts[i]}</text>`;
    }
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${grid}${bars}</svg>`;
}

/**
 * 横向条形图 + 中线：每行一条（label + value），中线标记基准（如先手胜率 0.5）。
 * 值偏离中线用红/绿表示方向。用于地图先手胜率、控制点易手等平衡指标。
 */
export function hbarMidline({ rows, midline = 0.5, min = 0, max = 1, format, height }) {
  if (!rows.length) return '<div class="chart-empty">无数据</div>';
  const rowH = 34, padL = 96, padR = 54, padT = 10, padB = 8;
  const W = 680, H = height || (padT + padB + rows.length * rowH);
  const chartW = W - padL - padR;
  const scale = val => padL + ((val - min) / (max - min)) * chartW;
  const midX = scale(midline);
  let out = '';
  // 中线
  out += `<line x1="${midX}" y1="${padT - 2}" x2="${midX}" y2="${H - padB + 4}" stroke="${AXIS}" stroke-width="1.5" stroke-dasharray="4 3"/>`;
  out += `<text x="${midX}" y="${padT - 8}" text-anchor="middle" font-size="9" fill="${TEXT_DIM}">${format ? format(midline) : midline}</text>`;
  rows.forEach((r, i) => {
    const y = padT + i * rowH;
    const x = scale(r.value);
    const right = r.value >= midline;
    const barColor = r.color || (right ? CHART_COLORS[0] : '#e8a06c');
    out += `<text x="${padL - 8}" y="${y + 16}" text-anchor="end" font-size="11" fill="${TEXT}">${esc(r.label)}</text>`;
    // 从中线到值画条（负方向往左）
    const bw = Math.abs(x - midX);
    const bx = Math.min(x, midX);
    out += `<rect x="${bx}" y="${y + 4}" width="${Math.max(1.5, bw)}" height="16" rx="2" fill="${barColor}" opacity="0.9"/>`;
    out += `<text x="${right ? x + 6 : x - 6}" y="${y + 16}" text-anchor="${right ? 'start' : 'end'}" font-size="10" fill="${TEXT_BRIGHT}">${format ? format(r.value) : r.value}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${out}</svg>`;
}

/**
 * 水平堆叠条：每行由若干段（segments）按比例拼接，用于动作类型 / 意图分布。
 * rows: [{ label, segments: [{ value, color, title }] }]；total 归一化由调用方保证。
 */
export function stackedHBar({ rows, legend = [] }) {
  if (!rows.length) return '<div class="chart-empty">无数据</div>';
  const rowH = 30, padL = 96, padR = 12, padT = 10, padB = legend.length ? 30 : 8;
  const W = 680, H = padT + padB + rows.length * rowH;
  const chartW = W - padL - padR;
  let out = '';
  rows.forEach((r, i) => {
    const y = padT + i * rowH;
    out += `<text x="${padL - 8}" y="${y + 16}" text-anchor="end" font-size="11" fill="${TEXT}">${esc(r.label)}</text>`;
    const total = r.segments.reduce((s, seg) => s + seg.value, 0) || 1;
    let x = padL;
    for (const seg of r.segments) {
      const w = (seg.value / total) * chartW;
      if (w > 0.5) {
        out += `<rect x="${x}" y="${y + 5}" width="${w}" height="14" fill="${seg.color}" opacity="0.92"><title>${esc(seg.title || seg.label || '')}：${esc(seg.value)}</title></rect>`;
      }
      x += w;
    }
    out += `<text x="${padL + chartW + 6}" y="${y + 16}" font-size="10" fill="${TEXT_DIM}">${total}</text>`;
  });
  if (legend.length) {
    let lx = padL;
    for (const lg of legend) {
      out += `<rect x="${lx}" y="${H - padB + 10}" width="9" height="9" rx="2" fill="${lg.color}"/>`;
      out += `<text x="${lx + 12}" y="${H - padB + 18}" font-size="10" fill="${TEXT}">${esc(lg.label)}</text>`;
      lx += 12 + lg.label.length * 12 + 16;
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${out}</svg>`;
}

/**
 * 雷达图：多系列（模型）叠加，每个系列在各轴上的值需归一化到 [0,1]。
 * axes: [{ key, label }]，series: [{ name, color, data: { key: value } }]。
 * 用于裁决 7 分项的风格指纹（量纲不同，调用方先相对归一化）。
 */
export function radarChart({ axes, series, size = 360 }) {
  if (!axes.length || !series.length) return '<div class="chart-empty">无数据</div>';
  const cx = size / 2, cy = size / 2;
  const r = size / 2 - 54;
  const n = axes.length;
  const angle = i => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const point = (i, v) => [cx + Math.cos(angle(i)) * r * v, cy + Math.sin(angle(i)) * r * v];

  let out = '';
  // 网格：0.25 / 0.5 / 0.75 / 1 四层多边形
  for (const f of [0.25, 0.5, 0.75, 1]) {
    const pts = axes.map((_, i) => point(i, f).join(',')).join(' ');
    out += `<polygon points="${pts}" fill="none" stroke="${GRID}" stroke-width="1"/>`;
  }
  // 轴线 + 轴标签
  axes.forEach((ax, i) => {
    const [ex, ey] = point(i, 1);
    out += `<line x1="${cx}" y1="${cy}" x2="${ex}" y2="${ey}" stroke="${AXIS}" stroke-width="1"/>`;
    const [lx, ly] = point(i, 1.22);
    out += `<text x="${lx}" y="${ly + 3}" text-anchor="middle" font-size="10" fill="${TEXT}">${esc(ax.label)}</text>`;
  });
  // 系列多边形
  for (const s of series) {
    const pts = axes.map((ax, i) => {
      const v = Math.max(0, Math.min(1, s.data?.[ax.key] ?? 0));
      return point(i, v).join(',');
    }).join(' ');
    out += `<polygon points="${pts}" fill="${s.color}" fill-opacity="0.16" stroke="${s.color}" stroke-width="1.6"/>`;
    axes.forEach((ax, i) => {
      const v = Math.max(0, Math.min(1, s.data?.[ax.key] ?? 0));
      const [px, py] = point(i, v);
      out += `<circle cx="${px}" cy="${py}" r="2.4" fill="${s.color}"/>`;
    });
  }
  return `<svg viewBox="0 0 ${size} ${size}" role="img">${out}</svg>`;
}

/**
 * 热力图矩阵：rows × cols，cell 值经 get(row, col) 取，按 [min,max] 映射绿→琥珀色阶。
 * 用于模型 × 地图交叉胜率（值域 0~1）。
 * SVG 带显式 width/height：矩阵宽高比偏竖，若交给 CSS width:100% 拉伸，
 * 高度会按比例暴涨（5 图 × 16 模型能撑到 1400px+），故按自然尺寸渲染。
 */
export function heatmap({ rows, cols, get, min = 0, max = 1, format, cellW = 68, cellH = 26, labelW = 108 }) {
  if (!rows.length || !cols.length) return '<div class="chart-empty">无数据</div>';
  const padL = labelW, padT = 26;
  const W = padL + cols.length * cellW + 12;
  const H = padT + rows.length * cellH + 12;
  const t = v => Math.max(0, Math.min(1, (v - min) / (max - min)));
  let out = '';
  cols.forEach((col, ci) => {
    out += `<text x="${padL + ci * cellW + cellW / 2}" y="${padT - 10}" text-anchor="middle" font-size="9" fill="${TEXT}">${esc(col.label)}</text>`;
  });
  rows.forEach((row, ri) => {
    out += `<text x="${padL - 6}" y="${padT + ri * cellH + cellH / 2 + 3}" text-anchor="end" font-size="10" fill="${TEXT}">${esc(row.label)}</text>`;
    cols.forEach((col, ci) => {
      const v = get(row, col);
      if (v == null) {
        out += `<rect x="${padL + ci * cellW}" y="${padT + ri * cellH}" width="${cellW - 2}" height="${cellH - 2}" rx="3" fill="#141c22"/>`;
        return;
      }
      const tt = t(v);
      // 绿(低) → 琥珀(高)：用于「胜率越高越显眼」的热力图。
      const color = `hsl(${Math.round(150 - 120 * tt)} 45% ${Math.round(30 + 16 * tt)}%)`;
      out += `<rect x="${padL + ci * cellW}" y="${padT + ri * cellH}" width="${cellW - 2}" height="${cellH - 2}" rx="3" fill="${color}"><title>${esc(row.label)} × ${esc(col.label)}：${format ? format(v) : v}</title></rect>`;
      out += `<text x="${padL + ci * cellW + (cellW - 2) / 2}" y="${padT + ri * cellH + (cellH - 2) / 2 + 3}" text-anchor="middle" font-size="9" fill="${tt > 0.55 ? '#0d1216' : '#dce8f0'}">${format ? format(v) : v}</text>`;
    });
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" class="heatmap-svg">${out}</svg>`;
}

/**
 * 散点图：points = [{ x, y, label, color }]，用于换座胜率差 vs 胜率的先手依赖检测。
 * 可叠加参考线（xref/yref）。
 */
export function scatter({ points, xLabel, yLabel, xref, yref, formatX, formatY, height = 300 }) {
  if (!points.length) return '<div class="chart-empty">无数据</div>';
  const W = 680, H = height;
  const padL = 46, padR = 14, padT = 16, padB = 44;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  let xMin = Math.min(...xs, xref ?? Infinity), xMax = Math.max(...xs, xref ?? -Infinity);
  let yMin = Math.min(...ys, yref ?? Infinity), yMax = Math.max(...ys, yref ?? -Infinity);
  const pad = (xMax - xMin) * 0.06 || 0.1, padY = (yMax - yMin) * 0.08 || 0.1;
  xMin -= pad; xMax += pad; yMin -= padY; yMax += padY;
  const sx = v => padL + ((v - xMin) / (xMax - xMin)) * chartW;
  const sy = v => padT + chartH - ((v - yMin) / (yMax - yMin)) * chartH;

  let out = '';
  const xticks = [xMin, (xMin + xMax) / 2, xMax];
  for (const t of xticks) {
    out += `<line x1="${sx(t)}" y1="${padT}" x2="${sx(t)}" y2="${padT + chartH}" stroke="${GRID}" stroke-width="1"/>`;
    out += `<text x="${sx(t)}" y="${H - padB + 16}" text-anchor="middle" font-size="9" fill="${TEXT_DIM}">${formatX ? formatX(t) : t}</text>`;
  }
  const yticks = [yMin, (yMin + yMax) / 2, yMax];
  for (const t of yticks) {
    out += `<line x1="${padL}" y1="${sy(t)}" x2="${W - padR}" y2="${sy(t)}" stroke="${GRID}" stroke-width="1"/>`;
    out += `<text x="${padL - 6}" y="${sy(t) + 3}" text-anchor="end" font-size="9" fill="${TEXT_DIM}">${formatY ? formatY(t) : t}</text>`;
  }
  if (xref != null) out += `<line x1="${sx(xref)}" y1="${padT}" x2="${sx(xref)}" y2="${padT + chartH}" stroke="${TEXT_DIM}" stroke-dasharray="4 3" stroke-width="1.2"/>`;
  if (yref != null) out += `<line x1="${padL}" y1="${sy(yref)}" x2="${W - padR}" y2="${sy(yref)}" stroke="${TEXT_DIM}" stroke-dasharray="4 3" stroke-width="1.2"/>`;
  out += `<text x="${W - padR}" y="${H - 4}" text-anchor="end" font-size="9" fill="${TEXT_DIM}">${esc(xLabel || '')}</text>`;
  out += `<text x="${padL}" y="${padT - 6}" font-size="9" fill="${TEXT_DIM}">${esc(yLabel || '')}</text>`;

  for (const p of points) {
    out += `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="4" fill="${p.color || CHART_COLORS[0]}" opacity="0.85"><title>${esc(p.label || '')}（${formatX ? formatX(p.x) : p.x}, ${formatY ? formatY(p.y) : p.y}）</title></circle>`;
    if (p.showLabel && p.label) {
      out += `<text x="${sx(p.x)}" y="${sy(p.y) - 7}" text-anchor="middle" font-size="9" fill="${TEXT}">${esc(p.label)}</text>`;
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${out}</svg>`;
}

/** 简易 SVG 迷你柱（KPI 内嵌用，无轴）。 */
export function sparkBars({ values, color = CHART_COLORS[0], height = 34 }) {
  const W = 200, n = values.length || 1;
  const max = Math.max(...values, 1);
  const slot = W / n, barW = Math.max(2, slot * 0.55);
  return `<svg viewBox="0 0 ${W} ${height}" preserveAspectRatio="none" role="img">${values.map((v, i) => {
    const h = Math.max(1, (v / max) * height);
    return `<rect x="${slot * i + (slot - barW) / 2}" y="${height - h}" width="${barW}" height="${h}" fill="${color}" opacity="0.85"/>`;
  }).join('')}</svg>`;
}
