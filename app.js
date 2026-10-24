(function () {
  'use strict';
  const core = window.ParameterPlots;
  const data = JSON.parse(document.getElementById('experiment-data').textContent);
  const element = id => document.getElementById(id);
  const label = key => core.dimensions.find(dimension => dimension.key === key).label;
  const escaped = core.escape;
  let state = core.defaultState(data, 'auto');
  let view;
  let chartArtifacts = [];
  let chartZoom = 1;
  let chartObservers = [];
  let toastTimer;

  function option(value, text) {
    const node = document.createElement('option');
    node.value = value;
    node.textContent = text;
    return node;
  }

  function restore() {
    try {
      const saved = new URLSearchParams(location.hash.slice(1)).get('view');
      if (saved) {
        const candidate = JSON.parse(saved);
        if (candidate.version !== 3) {
          state = core.defaultState(data, 'auto');
          return;
        }
        const automatic = { ...candidate, version: 3, scope: 'auto', aggregate: 'individual', pins: {} };
        const defaults = core.defaultState(data, 'auto');
        if (!core.dimensions.some(dimension => dimension.key === candidate.x) || !core.dimensions.some(dimension => dimension.key === candidate.y)) {
          automatic.x = defaults.x;
          automatic.y = defaults.y;
        }
        core.dimensions.forEach(dimension => {
          if ([automatic.x, automatic.y].includes(dimension.key)) return;
          automatic.pins[dimension.key] = candidate.pins?.[dimension.key] ?? defaults.pins[dimension.key] ?? core.parameter(core.representative(data.runs), dimension.key);
        });
        if (!candidate.pins?.epsilon && Number.isFinite(candidate.pins?.epsilon0) && Number.isFinite(candidate.pins?.k) && ![automatic.x, automatic.y].includes('epsilon')) {
          automatic.pins.epsilon = JSON.stringify([candidate.pins.epsilon0, candidate.pins.k]);
        }
        if (core.validateState(automatic, data)) state = automatic;
      }
    } catch (error) {
      toast('The saved view could not be restored. Showing the default selection.');
    }
  }

  function toast(message) {
    element('toast').textContent = message;
    element('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { element('toast').hidden = true; }, 4000);
  }

  function remember() {
    const fragment = new URLSearchParams({ view: JSON.stringify(state) });
    try { history.replaceState(null, '', '#' + fragment.toString()); } catch (error) { }
  }

  function fixedText() {
    return core.activeDimensions(state).filter(dimension => ![state.x, state.y].includes(dimension.key))
      .map(dimension => `${dimension.label}: ${core.format(state.pins[dimension.key])}`).join(' · ');
  }

  function renderFixedControls() {
    const collection = core.scopeRuns(data, state.scope);
    element('fixed-fields').replaceChildren();
    core.activeDimensions(state).filter(dimension => ![state.x, state.y].includes(dimension.key)).forEach(dimension => {
      const field = document.createElement('label');
      const caption = document.createElement('span');
      caption.textContent = dimension.label;
      const select = document.createElement('select');
      select.dataset.pin = dimension.key;
      select.setAttribute('aria-label', 'Fixed ' + dimension.label);
      const values = ['*', ...core.unique(collection.map(run => core.parameter(run, dimension.key)))];
      values.forEach(value => {
        const count = collection.filter(run => core.matches(run, state, dimension.key) &&
          (value === '*' || core.key(core.parameter(run, dimension.key)) === core.key(value))).length;
        select.append(option(core.key(value), `${core.format(value)} (${count} runs)`));
      });
      select.value = core.key(state.pins[dimension.key]);
      select.addEventListener('change', () => {
        state.pins[dimension.key] = values.find(value => core.key(value) === select.value);
        render();
      });
      field.append(caption, select);
      element('fixed-fields').append(field);
    });
    const count = core.activeDimensions(state).length - 2;
    element('fixed-summary').textContent = `${count} parameter conditions`;
    element('pinned-chips').innerHTML = core.activeDimensions(state).filter(dimension => ![state.x, state.y].includes(dimension.key))
      .map(dimension => `<span class="chip">${escaped(dimension.label)} <strong>${escaped(core.format(state.pins[dimension.key]))}</strong></span>`).join('');
  }

  function flags(run) {
    const entries = [];
    if (run.meta.timeLimit) entries.push('Stage time limit');
    if (run.meta.warning) entries.push('Numerical warning');
    if (run.meta.validation === true) entries.push('Validation passed');
    if (run.meta.validation === false) entries.push('Validation failed');
    if (run.meta.validation === null) entries.push('Validation not recorded');
    if (run.meta.jointPass === true) entries.push('Joint acceptance met');
    if (run.meta.jointPass === false) entries.push('Joint acceptance not met');
    return entries.join(' · ');
  }

  function rawTable(runs) {
    if (!runs.length) return '<p class="small-note">No recorded attempts at this point.</p>';
    const rows = runs.map(run => {
      const metricValues = core.metrics.map(metric => `<td>${run.meta.state === 'completed' ? escaped(core.number(run.metrics[metric.key], metric.key)) : 'NA'}</td>`).join('');
      const parameters = core.dimensions.map(dimension => `${dimension.label}: ${core.format(core.parameter(run, dimension.key))}`).join(' · ');
      return `<tr><td><strong>${escaped(run.case)}</strong><br><span class="small-note">${escaped(run.protocol)}</span><br><span class="small-note">${escaped(run.id)}</span></td><td>${escaped(parameters)}</td><td>${escaped(run.meta.state || 'Not recorded')}</td>${metricValues}<td>${escaped(flags(run))}</td><td>${escaped(run.meta.failureStage || '—')}${run.meta.error ? '<br>' + escaped(run.meta.error) : ''}</td></tr>`;
    }).join('');
    return '<table><thead><tr><th>Run / source</th><th>Parameters</th><th>Status</th><th>Fit min</th><th>Waste %</th><th>ATPm / BAC</th><th>Latent</th><th>Quality evidence</th><th>Failure stage / error</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function showPoint(index, runIndex) {
    const cell = view.cells[index];
    const run = cell.runs[runIndex];
    element('inspector-title').textContent = `${label(state.x)} = ${core.format(cell.x)} / ${label(state.y)} = ${core.format(cell.y)}`;
    element('inspector-summary').textContent = run ? `Selected run: ${run.case}. Each circle is one original attempt; no averaging. ${cell.runs.length} total runs at this parameter pair.` : 'No recorded run at this parameter pair.';
    element('point-table').innerHTML = rawTable(run ? [run] : []);
    element('inspector').hidden = false;
    element('inspector').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function hideTooltip() {
    element('tooltip').hidden = true;
    document.querySelectorAll('.plot-point.highlight').forEach(node => node.classList.remove('highlight'));
  }

  function showTooltip(index, event, target, runIndex) {
    const cell = view.cells[index];
    const run = cell.runs[runIndex];
    const tooltip = element('tooltip');
    tooltip.innerHTML = `<strong>${escaped(label(state.x))}: ${escaped(core.format(cell.x))}<br>${escaped(label(state.y))}: ${escaped(core.format(cell.y))}</strong>` +
      core.metrics.map(metric => {
        const value = run?.meta.state === 'completed' ? run.metrics[metric.key] : null;
        return `<div>${escaped(metric.title)}: <b>${escaped(core.number(value, metric.key))}</b> ${escaped(metric.unit)}</div>`;
      }).join('') + `<p>${run ? escaped(run.case + ' · ' + run.meta.state) : 'Untested'}</p><small>${run ? escaped(core.dimensions.map(dimension => `${dimension.label}: ${core.format(core.parameter(run, dimension.key))}`).join(' · ')) : ''}</small><small>${run ? escaped(flags(run) + ' · ' + run.protocol) : ''}</small><small>One circle = one recorded run. Click for details.</small>`;
    tooltip.hidden = false;
    const rect = target.getBoundingClientRect();
    const clientX = event.clientX || rect.left + rect.width / 2;
    const clientY = event.clientY || rect.top;
    tooltip.style.left = Math.max(8, Math.min(clientX + 16, innerWidth - tooltip.offsetWidth - 12)) + 'px';
    tooltip.style.top = Math.max(8, Math.min(clientY + 12, innerHeight - tooltip.offsetHeight - 12)) + 'px';
    document.querySelectorAll(`.plot-point[data-cell="${index}"][data-run="${runIndex}"]`).forEach(node => node.classList.add('highlight'));
  }

  function renderCharts() {
    chartObservers.forEach(observer => observer.disconnect());
    chartObservers = [];
    chartArtifacts = core.metrics.map(metric => ({ ...core.chart(metric, view, state), metric }));
    element('charts').innerHTML = chartArtifacts.map((artifact, index) => `<article class="chart-card" data-chart="${index}"><div class="chart-header"><div><h2>${escaped(artifact.metric.title)}</h2><p class="chart-note">${escaped(artifact.metric.note)}</p></div><span class="metric-unit">${escaped(artifact.metric.unit)}</span></div><div class="plot-zoom" role="group" aria-label="Zoom ${escaped(artifact.metric.title)}"><button data-zoom="out" aria-label="Zoom out">−</button><input type="range" min="10" max="250" step="1" value="100" aria-label="Plot zoom percent"><button data-zoom="in" aria-label="Zoom in">+</button><output>100%</output><button data-zoom="width">Fit width</button><button data-zoom="all">Fit all</button><button data-zoom="reset">100%</button><span class="zoom-help">Zoom is linked across all outcomes</span></div><div class="chart-frame" style="--y-axis-width:${state.y === 'epsilon' ? '205px' : '115px'}"><div class="fixed-y-axis"><svg class="axis-layer" aria-label="Fixed Y axis"></svg></div><div class="chart-scroll" tabindex="0" aria-label="Pan ${escaped(artifact.metric.title)} plot">${artifact.svg}</div><div class="axis-corner">Y ↑ / X →</div><div class="fixed-x-axis"><svg class="axis-layer" aria-label="Fixed X axis"></svg></div></div><div class="color-key"><span>${escaped(core.number(artifact.range[0], artifact.metric.key))}</span><div class="ramp"></div><span>${escaped(core.number(artifact.range[1], artifact.metric.key))}</span><small class="scale-mode">Higher value →</small></div></article>`).join('');
    document.querySelectorAll('.plot-point').forEach(node => {
      const index = Number(node.dataset.cell);
      const runIndex = Number(node.dataset.run);
      node.addEventListener('pointerenter', event => showTooltip(index, event, node, runIndex));
      node.addEventListener('pointermove', event => showTooltip(index, event, node, runIndex));
      node.addEventListener('pointerleave', hideTooltip);
      node.addEventListener('focus', event => showTooltip(index, event, node, runIndex));
      node.addEventListener('blur', hideTooltip);
      node.addEventListener('click', () => { hideTooltip(); showPoint(index, runIndex); });
      node.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showPoint(index, runIndex); }
      });
    });
    const scrollers = Array.from(document.querySelectorAll('.chart-scroll'));
    scrollers.forEach((scroller, index) => {
      const artifact = chartArtifacts[index];
      const svg = scroller.querySelector('.metric-svg');
      svg.setAttribute('viewBox', `${artifact.layout.padding.left} ${artifact.layout.padding.top} ${artifact.layout.plotWidth} ${artifact.layout.plotHeight}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.style.width = artifact.layout.plotWidth * chartZoom + 'px';
      svg.style.height = artifact.layout.plotHeight * chartZoom + 'px';
      svg.style.minWidth = '0';
      const card = scroller.closest('.chart-card');
      card.querySelector('input[type="range"]').addEventListener('input', event => setZoom(Number(event.target.value) / 100, index));
      card.querySelectorAll('[data-zoom]').forEach(button => button.addEventListener('click', () => {
        const command = button.dataset.zoom;
        const layout = artifact.layout;
        const next = command === 'width' ? scroller.clientWidth / layout.plotWidth : command === 'all' ? Math.min(scroller.clientWidth / layout.plotWidth, scroller.clientHeight / layout.plotHeight) : command === 'reset' ? 1 : chartZoom * (command === 'in' ? 1.25 : .8);
        setZoom(next, index, command === 'width' || command === 'all');
      }));
      scroller.addEventListener('wheel', event => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        const bounds = scroller.getBoundingClientRect();
        setZoom(chartZoom * Math.exp(-event.deltaY * .002), index, false, { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
      }, { passive: false });
      const observer = new ResizeObserver(() => drawAxes(index));
      observer.observe(scroller);
      chartObservers.push(observer);
    });
    const mostSampled = view.cells.reduce((best, cell, index) => cell.runs.length > (view.cells[best]?.runs.length || 0) ? index : best, 0);
    scrollers.forEach(scroller => {
      const anchor = scroller.querySelector(`.plot-point[data-cell="${mostSampled}"]`);
      if (anchor) {
        const box = anchor.getBBox();
        scroller.scrollLeft = Math.max(0, (box.x - chartArtifacts[0].layout.padding.left) * chartZoom - scroller.clientWidth / 3);
        scroller.scrollTop = Math.max(0, (box.y - chartArtifacts[0].layout.padding.top) * chartZoom - 100);
      }
      scroller.addEventListener('scroll', () => {
        hideTooltip();
        scrollers.forEach(other => {
          if (other !== scroller && (other.scrollLeft !== scroller.scrollLeft || other.scrollTop !== scroller.scrollTop)) {
            other.scrollLeft = scroller.scrollLeft;
            other.scrollTop = scroller.scrollTop;
          }
        });
        scrollers.forEach((other, index) => drawAxes(index));
      });
    });
    updateZoomControls();
    scrollers.forEach((scroller, index) => drawAxes(index));
  }

  function updateZoomControls() {
    document.querySelectorAll('.plot-zoom').forEach(controls => {
      controls.querySelector('input').value = Math.round(chartZoom * 100);
      controls.querySelector('output').textContent = Math.round(chartZoom * 100) + '%';
    });
  }

  function setZoom(value, sourceIndex, fit = false, anchor) {
    const scrollers = Array.from(document.querySelectorAll('.chart-scroll'));
    const source = scrollers[sourceIndex];
    if (!source) return;
    const focus = anchor || { x: source.clientWidth / 2, y: source.clientHeight / 2 };
    const coordinate = { x: (source.scrollLeft + focus.x) / chartZoom, y: (source.scrollTop + focus.y) / chartZoom };
    chartZoom = Math.max(.1, Math.min(2.5, value));
    hideTooltip();
    scrollers.forEach((scroller, index) => {
      const layout = chartArtifacts[index].layout;
      const svg = scroller.querySelector('.metric-svg');
      svg.style.width = layout.plotWidth * chartZoom + 'px';
      svg.style.height = layout.plotHeight * chartZoom + 'px';
      scroller.scrollLeft = fit ? 0 : coordinate.x * chartZoom - focus.x;
      scroller.scrollTop = fit ? 0 : coordinate.y * chartZoom - focus.y;
      drawAxes(index);
    });
    updateZoomControls();
  }

  function drawAxes(index) {
    const card = document.querySelector(`[data-chart="${index}"]`);
    if (!card) return;
    const scroller = card.querySelector('.chart-scroll');
    const layout = chartArtifacts[index].layout;
    ['x', 'y'].forEach(orientation => {
      const horizontal = orientation === 'x';
      const holder = card.querySelector(horizontal ? '.fixed-x-axis' : '.fixed-y-axis');
      const svg = holder.querySelector('svg');
      const width = horizontal ? scroller.clientWidth : holder.clientWidth;
      const height = horizontal ? holder.clientHeight : scroller.clientHeight;
      const length = horizontal ? width : height;
      const offset = horizontal ? scroller.scrollLeft : scroller.scrollTop;
      const ticks = layout[horizontal ? 'xTicks' : 'yTicks'];
      svg.setAttribute('width', width);
      svg.setAttribute('height', height);
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.dataset.offset = String(offset);
      svg.dataset.zoom = String(chartZoom);
      let content = '';
      let lastPosition = -Infinity;
      [...ticks].sort((left, right) => left.position - right.position).forEach(tick => {
        if (tick.end * chartZoom < offset || tick.start * chartZoom > offset + length) return;
        const raw = tick.position * chartZoom - offset;
        const edge = horizontal ? Math.min(state.x === 'epsilon' ? 58 : 24, length / 3) : 16;
        const position = Math.max(edge, Math.min(length - edge, raw));
        const minimumGap = horizontal ? (state.x === 'epsilon' ? 118 : 42) : 25;
        if (position - lastPosition < minimumGap) return;
        lastPosition = position;
        const text = core.format(tick.value);
        const parts = horizontal && state.x === 'epsilon' ? JSON.parse(tick.value).map(core.format) : [text];
        if (horizontal) {
          content += `<g data-tick="${escaped(text)}"><title>${escaped(text)}</title><line x1="${position}" x2="${position}" y1="0" y2="6" stroke="#8aa0b1"/><text x="${position}" y="22" text-anchor="middle" font-size="11" fill="#3f586e">${parts.map((part, partIndex) => `<tspan x="${position}" dy="${partIndex ? 14 : 0}">${escaped(part)}</tspan>`).join('')}</text></g>`;
        } else {
          content += `<g data-tick="${escaped(text)}"><title>${escaped(text)}</title><line x1="${width - 6}" x2="${width}" y1="${position}" y2="${position}" stroke="#8aa0b1"/><text x="${width - 12}" y="${position + 4}" text-anchor="end" font-size="11" fill="#3f586e">${escaped(text)}</text></g>`;
        }
      });
      content += horizontal ? `<text x="${width / 2}" y="${height - 10}" text-anchor="middle" font-size="12" font-weight="600" fill="#22465f">${escaped(label(state.x))}</text>` : `<text transform="translate(15,${height / 2}) rotate(-90)" text-anchor="middle" font-size="12" font-weight="600" fill="#22465f">${escaped(label(state.y))}</text>`;
      svg.innerHTML = content;
    });
  }

  function render() {
    view = core.collect(data, state);
    element('show-all').textContent = `Show all ${data.runs.length} runs`;
    const scan = data.meta.scanSummary;
    element('scan-progress').hidden = !scan;
    if (scan) element('scan-progress').textContent = `Supplemental epsilon / ATPm scan: ${scan.recorded} / ${scan.total} attempts recorded · ${scan.completed} completed · ${scan.failed + scan.external_timeout + scan.interrupted} failed / stopped · ${scan.running} running · ${scan.pending} pending. Only finished attempts enter the plots and Excel. Last local build: ${scan.updated_local}. Refresh or reopen after an update.`;
    element('scope-description').textContent = `${data.runs.length} total recorded runs. Current conditions match ${view.selected.length}. All matching attempts appear together, including failures. Threads, workflow, seed and historical version do not filter or split the plots.`;
    element('x-axis').value = state.x;
    element('y-axis').value = state.y;
    element('color-scale').value = state.scale;
    element('untested').checked = state.untested;
    document.querySelectorAll('[data-shape]').forEach(button => {
      button.classList.toggle('active', button.dataset.shape === state.shape);
      button.setAttribute('aria-pressed', button.dataset.shape === state.shape ? 'true' : 'false');
    });
    renderFixedControls();
    element('axis-summary').textContent = `X: ${label(state.x)}  ×  Y: ${label(state.y)}`;
    element('selection-summary').innerHTML = `<div class="selection-title">Showing ${view.selected.length} of ${data.runs.length} recorded runs<span>${view.tested} parameter pairs · ${view.completed} returned · ${view.selected.length - view.completed} failed / interrupted · ${data.runs.length - view.selected.length} outside current fixed conditions</span></div>`;
    element('empty-state').hidden = view.selected.length > 0;
    element('charts').hidden = !view.selected.length;
    element('export-svg').disabled = !view.selected.length;
    element('export-png').disabled = !view.selected.length;
    element('inspector').hidden = true;
    hideTooltip();
    renderCharts();
    element('runs-title').textContent = `Matching runs (${view.selected.length})`;
    element('runs-table').innerHTML = rawTable(view.selected);
    element('view-note').textContent = `Each circle is one original run; all matching versions, seeds, threads and PFD/OFD runs are shown together, without averaging. Several circles at one coordinate are separate attempts, not extra parameter values. FAIL = failed; STOP = externally stopped; NA = missing outcome (for example latent count in a PFD-only run). Metadata remain in the raw records. Code versions and runtime conditions can differ, so this overview is not a controlled speed comparison. All-values conditions allow other biological parameters to vary too.`;
    element('source-count').textContent = `${data.runs.length} recorded attempts · automatic matching`;
    remember();
    window.ParameterExplorer = { data, state, view, render, exportFigure, core };
  }

  function changeAxes(xaxis, yaxis) {
    state = core.setAxes(state, xaxis, yaxis, core.scopeRuns(data, state.scope));
    render();
  }

  function download(content, filename, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const address = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = address;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(address), 30000);
  }

  function exportFigure() {
    const cardWidth = Math.max(...chartArtifacts.map(artifact => artifact.width)) + 32;
    const cardHeight = Math.max(...chartArtifacts.map(artifact => artifact.height)) + 114;
    const width = cardWidth + 40;
    const fixed = fixedText().split(' · ');
    const wrapped = [];
    fixed.forEach(value => {
      const last = wrapped.length - 1;
      if (last < 0 || (wrapped[last] + ' · ' + value).length > 130) wrapped.push(value);
      else wrapped[last] += ' · ' + value;
    });
    const top = 100 + wrapped.length * 20;
    const height = top + (cardHeight + 55) * 4 + 145;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="font-family:Arial,sans-serif"><rect width="100%" height="100%" fill="#f5f7f9"/><text x="30" y="40" font-size="25" font-weight="700" fill="#1e3449">AllTissue / Parameter Explorer</text><text x="30" y="68" font-size="13" fill="#48566a">All versions together · ${view.selected.length} attempts · One mark per original run · No averaging</text>`;
    wrapped.forEach((line, index) => { svg += `<text x="30" y="${92 + index * 20}" font-size="11" fill="#48566a">${escaped(line)}</text>`; });
    chartArtifacts.forEach((artifact, index) => {
      const left = 20;
      const upper = top + index * (cardHeight + 55) + 28;
      svg += `<g transform="translate(${left},${upper})"><rect width="${cardWidth}" height="${cardHeight}" rx="12" fill="white" stroke="#e0e6ec"/><text x="16" y="28" font-size="18" font-weight="700" fill="#1e3449">${escaped(artifact.metric.title)}</text><text x="16" y="49" font-size="11" fill="#596b7e">${escaped(artifact.metric.note)}</text>`;
      svg += artifact.svg.replaceAll('gradient-' + artifact.metric.key, 'gradient-' + index).replace('<svg ', `<svg x="16" y="57" width="${artifact.width}" height="${artifact.height}" `);
      const legendY = cardHeight - 27;
      svg += `<text x="16" y="${legendY + 4}" font-size="11" fill="#48566a">${escaped(core.number(artifact.range[0], artifact.metric.key))}</text><rect x="70" y="${legendY - 8}" width="160" height="10" rx="5" fill="url(#gradient-${index})"/><text x="240" y="${legendY + 4}" font-size="11" fill="#48566a">${escaped(core.number(artifact.range[1], artifact.metric.key))} ${escaped(artifact.metric.unit)}</text></g>`;
    });
    svg += `<text x="30" y="${height - 64}" font-size="11" fill="#48566a">— Untested · FAIL Failed · STOP Externally stopped · NA Missing · ! Stage time limit · † Numerical warning</text><text x="30" y="${height - 42}" font-size="11" fill="#48566a">Sampled parameter categories; small offsets separate runs at the same pair. No averaging or interpolation.</text><text x="30" y="${height - 20}" font-size="11" fill="#48566a">Versions, seeds, threads and PFD/OFD are combined for viewing, not a controlled speed comparison. All-values conditions may mix other parameters.</text></svg>`;
    return { svg, width, height };
  }

  function exportCSV() {
    const rows = view.selected.map(run => {
      const row = { run_id: run.id, case: run.case, collection: run.scope, protocol: run.protocol, ...run.params, status: run.meta.state };
      core.metrics.forEach(metric => { row[metric.key] = run.meta.state === 'completed' ? run.metrics[metric.key] : null; });
      Object.assign(row, { stage_time_limit: run.meta.timeLimit, numerical_warning: run.meta.warning, validation_passed: run.meta.validation,
        joint_acceptance: run.meta.jointPass, failure_stage: run.meta.failureStage, error: run.meta.error, epsilon_file: run.meta.epsilonFile, source: run.meta.source });
      return row;
    });
    if (!rows.length) { toast('No matching runs to export.'); return; }
    download(core.csv(rows, Object.keys(rows[0])), 'alltissue-matching-runs.csv', 'text/csv;charset=utf-8');
  }

  ['x-axis', 'y-axis'].forEach(id => core.activeDimensions(state).forEach(dimension => element(id).append(option(dimension.key, dimension.label))));
  element('x-axis').addEventListener('change', () => changeAxes(element('x-axis').value, element('x-axis').value === state.y ? state.x : state.y));
  element('y-axis').addEventListener('change', () => changeAxes(element('y-axis').value === state.x ? state.y : state.x, element('y-axis').value));
  element('swap').addEventListener('click', () => changeAxes(state.y, state.x));
  document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => changeAxes(...button.dataset.preset.split(','))));
  document.querySelectorAll('[data-shape]').forEach(button => button.addEventListener('click', () => { state.shape = button.dataset.shape; render(); }));
  element('color-scale').addEventListener('change', () => { state.scale = element('color-scale').value; render(); });
  element('show-all').addEventListener('click', () => {
    core.dimensions.forEach(dimension => { if (![state.x, state.y].includes(dimension.key)) state.pins[dimension.key] = '*'; });
    render();
  });
  element('untested').addEventListener('change', () => { state.untested = element('untested').checked; render(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hideTooltip(); });
  element('inspector-close').addEventListener('click', () => { element('inspector').hidden = true; });
  element('reset').addEventListener('click', () => { state = core.defaultState(data, state.scope); render(); });
  element('copy-link').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); toast('View link copied. Share it with access to the same HTML file.'); }
    catch (error) { window.prompt('Copy this view link (requires access to the same file):', location.href); }
  });
  element('export-svg').addEventListener('click', () => download(exportFigure().svg, 'alltissue-parameter-slice.svg', 'image/svg+xml'));
  element('export-png').addEventListener('click', async () => {
    const figure = exportFigure();
    const address = URL.createObjectURL(new Blob([figure.svg], { type: 'image/svg+xml' }));
    try {
      const image = new Image();
      image.src = address;
      await image.decode();
      const canvas = document.createElement('canvas');
      const scale = Math.min(2, 4096 / figure.width, 16000 / figure.height, Math.sqrt(24000000 / (figure.width * figure.height)));
      canvas.width = Math.round(figure.width * scale);
      canvas.height = Math.round(figure.height * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('The browser did not produce a PNG.');
      download(blob, 'alltissue-parameter-slice.png', 'image/png');
      toast('PNG exported.');
    } catch (error) { toast('PNG export is unavailable in this browser. Please use SVG export.'); }
    finally { URL.revokeObjectURL(address); }
  });
  element('export-csv').addEventListener('click', exportCSV);
  window.addEventListener('hashchange', () => { restore(); render(); });
  restore();
  render();
})();
