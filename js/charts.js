export function renderBarChart(container, items, { valueFormatter } = {}) {
  container.innerHTML = '';

  if (!items || items.length === 0) {
    container.innerHTML = '<p class="empty">No data available.</p>';
    return;
  }

  const max = Math.max(...items.map((item) => item.value), 1);

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'bar-row';

    const label = document.createElement('span');
    label.className = 'bar-label';
    label.textContent = item.label;

    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = `${(item.value / max) * 100}%`;
    track.appendChild(fill);

    const value = document.createElement('span');
    value.className = 'bar-value';
    value.textContent = valueFormatter ? valueFormatter(item.value) : item.value;

    row.append(label, track, value);
    container.appendChild(row);
  }
}
