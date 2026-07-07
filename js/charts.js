// Dependency-free SVG chart components.
// All charts are single-series: color comes from the CSS custom properties
// --series (mark fill) and the chart chrome tokens defined in style.css,
// so light/dark theming happens in one place.

const SVG_NS = 'http://www.w3.org/2000/svg';

const PAD = { top: 12, right: 12, bottom: 24, left: 40 };
const BAR_MAX_THICKNESS = 24;
const DATA_END_RADIUS = 4;

// ---------------------------------------------------------------------------
// Redraw plumbing: every chart re-renders on container resize and on
// light/dark scheme changes, re-reading its colors from CSS each time.

const redrawFns = new Map();
const resizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const fn = redrawFns.get(entry.target);
    if (fn) fn();
  }
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  redrawAll();
});

export function redrawAll() {
  for (const fn of redrawFns.values()) fn();
}

function register(container, redraw) {
  const firstTime = !redrawFns.has(container);
  let scheduled = false;
  redrawFns.set(container, () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      redraw();
    });
  });
  if (firstTime) resizeObserver.observe(container);
}

function token(container, name) {
  return getComputedStyle(container).getPropertyValue(name).trim();
}

// ---------------------------------------------------------------------------
// Shared tooltip (one per page).

let tooltipEl = null;

function tooltip() {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'viz-tooltip';
    tooltipEl.setAttribute('role', 'status');
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

function showTooltip(clientX, clientY, label, valueText) {
  const el = tooltip();
  el.textContent = '';
  const value = document.createElement('span');
  value.className = 'viz-tooltip-value';
  value.textContent = valueText;
  const name = document.createElement('span');
  name.className = 'viz-tooltip-label';
  name.textContent = label;
  el.append(value, name);
  el.style.display = 'block';
  const rect = el.getBoundingClientRect();
  const x = Math.min(clientX + 12, window.innerWidth - rect.width - 8);
  const y = Math.max(clientY - rect.height - 12, 8);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

function hideTooltip() {
  if (tooltipEl) tooltipEl.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Scale helpers.

function niceTicks(maxValue) {
  if (maxValue <= 0) return { ticks: [0, 1], max: 1 };
  const rough = maxValue / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const step = (residual < 1.5 ? 1 : residual < 3.5 ? 2 : residual < 7.5 ? 5 : 10) * magnitude;
  const top = Math.ceil(maxValue / step) * step;
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { ticks, max: top };
}

function formatTick(value) {
  if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${+(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function svgEl(name, attrs = {}) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

function drawFrame(svg, container, width, height, maxValue) {
  const { ticks, max } = niceTicks(maxValue);
  const gridColor = token(container, '--grid');
  const baselineColor = token(container, '--baseline');
  const mutedInk = token(container, '--ink-muted');
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const yFor = (v) => PAD.top + plotH - (v / max) * plotH;

  for (const tick of ticks) {
    const y = yFor(tick);
    svg.appendChild(svgEl('line', {
      x1: PAD.left, x2: width - PAD.right, y1: y, y2: y,
      stroke: tick === 0 ? baselineColor : gridColor, 'stroke-width': 1,
    }));
    const label = svgEl('text', {
      x: PAD.left - 6, y: y + 3.5, 'text-anchor': 'end',
      fill: mutedInk, 'font-size': 11, style: 'font-variant-numeric: tabular-nums',
    });
    label.textContent = formatTick(tick);
    svg.appendChild(label);
  }

  return { plotW, plotH, yFor, max };
}

function xLabelIndexes(count, plotW) {
  const maxLabels = Math.max(2, Math.floor(plotW / 48));
  const every = Math.ceil(count / maxLabels);
  const indexes = new Set();
  for (let i = 0; i < count; i += every) indexes.add(i);
  indexes.add(count - 1);
  return indexes;
}

function buildTableView(container, items, formatValue, columns) {
  const existing = container.parentElement?.querySelector(':scope > details.viz-table');
  if (existing) existing.remove();
  const details = document.createElement('details');
  details.className = 'viz-table';
  const summary = document.createElement('summary');
  summary.textContent = 'View as table';
  details.appendChild(summary);
  const table = document.createElement('table');
  const head = document.createElement('tr');
  for (const col of columns) {
    const th = document.createElement('th');
    th.textContent = col;
    head.appendChild(th);
  }
  table.appendChild(head);
  for (const item of items) {
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td');
    tdLabel.textContent = item.label;
    const tdValue = document.createElement('td');
    tdValue.textContent = formatValue(item.value);
    tr.append(tdLabel, tdValue);
    table.appendChild(tr);
  }
  details.appendChild(table);
  container.after(details);
}

function emptyState(container, message) {
  container.textContent = '';
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = message || 'No data available.';
  container.appendChild(p);
}

// ---------------------------------------------------------------------------
// Column chart — magnitude over an ordered axis (hours, weekdays, years).

export function renderColumnChart(container, items, opts = {}) {
  register(container, () => renderColumnChart(container, items, opts));

  if (!items || items.length === 0) return emptyState(container, opts.emptyMessage);

  container.textContent = '';
  const width = Math.max(container.clientWidth, 200);
  const height = opts.height || 180;
  const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img' });
  container.appendChild(svg);

  const maxValue = Math.max(...items.map((d) => d.value));
  const { plotW, plotH, yFor } = drawFrame(svg, container, width, height, maxValue);
  const seriesColor = token(container, '--series');
  const mutedInk = token(container, '--ink-muted');
  const formatValue = opts.formatValue || ((v) => v.toLocaleString());

  const slot = plotW / items.length;
  const barW = Math.max(2, Math.min(BAR_MAX_THICKNESS, slot - 2));
  const baseline = PAD.top + plotH;
  const labelAt = xLabelIndexes(items.length, plotW);

  items.forEach((item, i) => {
    const x = PAD.left + i * slot + (slot - barW) / 2;
    const y = yFor(item.value);
    const h = baseline - y;
    const r = Math.min(DATA_END_RADIUS, h, barW / 2);
    if (h > 0) {
      svg.appendChild(svgEl('path', {
        d: `M ${x} ${baseline} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + barW - r} ${y} Q ${x + barW} ${y} ${x + barW} ${y + r} L ${x + barW} ${baseline} Z`,
        fill: seriesColor,
        'data-col': i,
      }));
    }

    if (labelAt.has(i)) {
      const label = svgEl('text', {
        x: x + barW / 2, y: height - 8, 'text-anchor': 'middle',
        fill: mutedInk, 'font-size': 11,
      });
      label.textContent = item.label;
      svg.appendChild(label);
    }
  });

  // Full-height transparent hit rects: the target is the whole slot, not the bar.
  items.forEach((item, i) => {
    const hit = svgEl('rect', {
      x: PAD.left + i * slot, y: PAD.top, width: slot, height: plotH,
      fill: 'transparent', tabindex: 0, 'aria-label': `${item.label}: ${formatValue(item.value)}`,
    });
    const activate = (clientX, clientY) => {
      showTooltip(clientX, clientY, item.label, formatValue(item.value));
      svg.querySelectorAll('[data-col]').forEach((bar) => {
        bar.style.opacity = bar.dataset.col === String(i) ? '1' : '0.45';
      });
    };
    const deactivate = () => {
      hideTooltip();
      svg.querySelectorAll('[data-col]').forEach((bar) => { bar.style.opacity = '1'; });
    };
    hit.addEventListener('pointermove', (e) => activate(e.clientX, e.clientY));
    hit.addEventListener('pointerleave', deactivate);
    hit.addEventListener('focus', () => {
      const rect = hit.getBoundingClientRect();
      activate(rect.left + rect.width / 2, rect.top);
    });
    hit.addEventListener('blur', deactivate);
    svg.appendChild(hit);
  });

  buildTableView(container, items, formatValue, [opts.categoryName || 'Category', opts.valueName || 'Value']);
}

// ---------------------------------------------------------------------------
// Area chart — a single series over time, with crosshair + snapping tooltip.

export function renderAreaChart(container, points, opts = {}) {
  register(container, () => renderAreaChart(container, points, opts));

  if (!points || points.length === 0) return emptyState(container, opts.emptyMessage);
  if (points.length === 1) return renderColumnChart(container, points, opts);

  container.textContent = '';
  const width = Math.max(container.clientWidth, 200);
  const height = opts.height || 220;
  const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img' });
  container.appendChild(svg);

  const maxValue = Math.max(...points.map((d) => d.value));
  const { plotW, plotH, yFor } = drawFrame(svg, container, width, height, maxValue);
  const seriesColor = token(container, '--series');
  const surface = token(container, '--surface-1');
  const mutedInk = token(container, '--ink-muted');
  const primaryInk = token(container, '--ink-primary');
  const formatValue = opts.formatValue || ((v) => v.toLocaleString());

  const baseline = PAD.top + plotH;
  const xFor = (i) => PAD.left + (i / (points.length - 1)) * plotW;
  const lineD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(p.value).toFixed(1)}`).join(' ');

  svg.appendChild(svgEl('path', {
    d: `${lineD} L ${xFor(points.length - 1).toFixed(1)} ${baseline} L ${xFor(0).toFixed(1)} ${baseline} Z`,
    fill: seriesColor, 'fill-opacity': 0.1,
  }));
  svg.appendChild(svgEl('path', {
    d: lineD, fill: 'none', stroke: seriesColor,
    'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  }));

  const labelAt = xLabelIndexes(points.length, plotW);
  points.forEach((p, i) => {
    if (!labelAt.has(i)) return;
    const label = svgEl('text', {
      x: xFor(i), y: height - 8, 'text-anchor': i === points.length - 1 ? 'end' : 'middle',
      fill: mutedInk, 'font-size': 11,
    });
    label.textContent = p.label;
    svg.appendChild(label);
  });

  // Endpoint marker (2px surface ring) + direct label of the latest value.
  const lastX = xFor(points.length - 1);
  const lastY = yFor(points[points.length - 1].value);
  svg.appendChild(svgEl('circle', {
    cx: lastX, cy: lastY, r: 4.5, fill: seriesColor, stroke: surface, 'stroke-width': 2,
  }));
  const endLabel = svgEl('text', {
    x: lastX - 8, y: Math.max(lastY - 9, PAD.top + 10), 'text-anchor': 'end',
    fill: primaryInk, 'font-size': 12, 'font-weight': 600,
  });
  endLabel.textContent = formatValue(points[points.length - 1].value);
  svg.appendChild(endLabel);

  // Crosshair layer.
  const crosshair = svgEl('line', {
    y1: PAD.top, y2: baseline, stroke: token(container, '--baseline'),
    'stroke-width': 1, visibility: 'hidden',
  });
  const dot = svgEl('circle', {
    r: 4.5, fill: seriesColor, stroke: surface, 'stroke-width': 2, visibility: 'hidden',
  });
  svg.append(crosshair, dot);

  const overlay = svgEl('rect', {
    x: PAD.left, y: PAD.top, width: plotW, height: plotH, fill: 'transparent',
    tabindex: 0, 'aria-label': opts.ariaLabel || 'Time series chart',
  });
  const snapTo = (i, clientY) => {
    const p = points[i];
    const x = xFor(i);
    crosshair.setAttribute('x1', x);
    crosshair.setAttribute('x2', x);
    crosshair.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', x);
    dot.setAttribute('cy', yFor(p.value));
    dot.setAttribute('visibility', 'visible');
    const svgRect = svg.getBoundingClientRect();
    showTooltip(svgRect.left + x, clientY ?? svgRect.top + yFor(p.value), p.label, formatValue(p.value));
  };
  const clear = () => {
    crosshair.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    hideTooltip();
  };
  overlay.addEventListener('pointermove', (e) => {
    const svgRect = svg.getBoundingClientRect();
    const px = e.clientX - svgRect.left;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(((px - PAD.left) / plotW) * (points.length - 1))));
    snapTo(i, e.clientY);
  });
  overlay.addEventListener('pointerleave', clear);
  overlay.addEventListener('focus', () => snapTo(points.length - 1));
  overlay.addEventListener('blur', clear);
  svg.appendChild(overlay);

  buildTableView(container, points, formatValue, [opts.categoryName || 'Period', opts.valueName || 'Value']);
}

// ---------------------------------------------------------------------------
// Horizontal bar list — ranked categories, every value directly labeled.

export function renderBarList(container, items, opts = {}) {
  register(container, () => renderBarList(container, items, opts));

  if (!items || items.length === 0) return emptyState(container, opts.emptyMessage);

  container.textContent = '';
  container.classList.add('viz-barlist');
  const max = Math.max(...items.map((item) => item.value), 1);
  const formatValue = opts.formatValue || ((v) => v.toLocaleString());

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'viz-bar-row';

    const label = document.createElement('span');
    label.className = 'viz-bar-label';
    label.textContent = item.label;
    label.title = item.label;

    const area = document.createElement('div');
    area.className = 'viz-bar-area';
    const fill = document.createElement('div');
    fill.className = 'viz-bar-fill';
    fill.style.width = `calc((100% - 64px) * ${(item.value / max).toFixed(4)})`;
    const value = document.createElement('span');
    value.className = 'viz-bar-value';
    value.textContent = formatValue(item.value);
    area.append(fill, value);

    row.append(label, area);
    container.appendChild(row);
  }
}

// Backwards-compatible alias for the old API name.
export const renderBarChart = renderBarList;
