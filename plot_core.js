(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ParameterPlots = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const dimensions = [
    { key: 'atpm', label: 'ATPm / tissue' },
    { key: 'bac', label: 'minBAC coefficient' },
    { key: 'exchange', label: 'minExchange coefficient' },
    { key: 'epsilon', label: 'Epsilon pair (ε₀ – k)' },
    { key: 'warm', label: 'Extra warm start' },
    { key: 'hard', label: 'Hard low constraint' }
  ];
  const metrics = [
    { key: 'runtime', title: 'Fit time', unit: 'minutes', note: 'Reference budget: ≤ 15 min', target: value => value <= 15 },
    { key: 'waste', title: 'Bacterial waste', unit: '%', note: 'Reference target: ≤ 10%', target: value => value <= 10 },
    { key: 'ratio', title: 'ATPm / BAC uptake', unit: 'ratio', note: 'Reference interval: 10–20', target: value => value >= 10 && value <= 20 },
    { key: 'latent', title: 'Latent reactions fitted', unit: 'count', note: 'No universal target; compare the same workflow', target: () => true }
  ];
  const palette = ['#f2f7fa', '#c8e2eb', '#88c1d1', '#4598b3', '#176a91', '#163b63'];

  function key(value) {
    return value === null || value === undefined ? 'null' : typeof value + ':' + String(value);
  }

  function format(value) {
    if (value === null || value === undefined) return 'Not recorded';
    if (value === 'off') return 'Off';
    if (value === '*') return 'All values (not fixed)';
    if (typeof value === 'string' && value.startsWith('[')) {
      try { return JSON.parse(value).map(item => format(item)).join(' – '); } catch (error) { }
    }
    if (typeof value !== 'number') return String(value);
    return Number(value.toPrecision(8)).toString();
  }

  function unique(values) {
    const lookup = new Map();
    values.forEach(value => lookup.set(key(value), value));
    return Array.from(lookup.values()).sort((left, right) => {
      if (left === right) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      if (left === 'off') return -1;
      if (right === 'off') return 1;
      if (typeof left === 'number' && typeof right === 'number') return left - right;
      return String(left).localeCompare(String(right));
    });
  }

  function scopeRuns(data, scope) {
    if (scope === 'auto') return data.runs;
    return data.runs.filter(run => run.scope === scope);
  }

  function activeDimensions(state) {
    return dimensions;
  }

  function parameter(run, dimension) {
    return dimension === 'epsilon' ? JSON.stringify([run.params.epsilon0, run.params.k]) : run.params[dimension];
  }

  function representative(runs) {
    return runs.find(run => run.case === 'a2_b1p1_s0') ||
      runs.find(run => run.params.atpm === 10 && run.params.bac === 1.1 &&
        run.params.exchange === 'off' && run.params.warm === 'On' && run.params.hard === 'On' && run.params.seed === 0) ||
      runs.find(run => run.meta.state === 'completed') || runs[0];
  }

  function defaultState(data, scope) {
    const runs = data.runs;
    if (!runs.length) throw new Error('The selected collection contains no records.');
    const pins = {};
    activeDimensions({ scope }).forEach(dimension => {
      if (!['atpm', 'bac'].includes(dimension.key)) pins[dimension.key] = '*';
    });
    return { version: 3, scope: 'auto', x: 'atpm', y: 'bac', pins, shape: 'circle', scale: 'slice', aggregate: 'individual', untested: true };
  }

  function setAxes(state, xaxis, yaxis, runs) {
    if (!activeDimensions(state).some(item => item.key === xaxis) || !activeDimensions(state).some(item => item.key === yaxis) || xaxis === yaxis) {
      throw new Error('Choose two different parameter axes.');
    }
    const reference = representative(runs);
    const pins = {};
    activeDimensions(state).forEach(dimension => {
      if ([xaxis, yaxis].includes(dimension.key)) return;
      pins[dimension.key] = Object.hasOwn(state.pins, dimension.key) ? state.pins[dimension.key] :
        parameter(reference, dimension.key);
    });
    return { ...state, x: xaxis, y: yaxis, pins };
  }

  function validateState(state, data) {
    if (state.x === state.y || !activeDimensions(state).some(item => item.key === state.x) || !activeDimensions(state).some(item => item.key === state.y)) return false;
    if (!['circle', 'tile'].includes(state.shape) || !['collection', 'slice'].includes(state.scale) || state.aggregate !== 'individual') return false;
    const runs = data.runs;
    return activeDimensions(state).every(dimension => {
      if ([state.x, state.y].includes(dimension.key)) return true;
      const value = state.pins?.[dimension.key];
      if (value === '*') return true;
      return runs.some(run => key(parameter(run, dimension.key)) === key(value)) && Object.hasOwn(state.pins, dimension.key);
    });
  }

  function matches(run, state, except) {
    return activeDimensions(state).every(dimension => {
      if ([state.x, state.y, except].includes(dimension.key)) return true;
      if (!Object.hasOwn(state.pins, dimension.key)) throw new Error('Every non-axis parameter must be fixed.');
      if (state.pins[dimension.key] === '*') return true;
      return key(parameter(run, dimension.key)) === key(state.pins[dimension.key]);
    });
  }

  function reduce(values, mode) {
    if (!values.length) return null;
    if (mode === 'mean') return values.reduce((total, value) => total + value, 0) / values.length;
    const ordered = [...values].sort((left, right) => left - right);
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
  }

  function collect(data, state) {
    if (!validateState(state, data)) throw new Error('The saved selection is not valid for this dataset.');
    const collection = data.runs;
    const selected = collection.filter(run => matches(run, state));
    const domains = selected.length ? selected : collection;
    const xvalues = unique(domains.map(run => parameter(run, state.x)));
    const yvalues = unique(domains.map(run => parameter(run, state.y)));
    const cells = [];
    yvalues.forEach(yvalue => xvalues.forEach(xvalue => {
      const runs = selected.filter(run => key(parameter(run, state.x)) === key(xvalue) && key(parameter(run, state.y)) === key(yvalue));
      const completed = runs.filter(run => run.meta.state === 'completed');
      const values = {};
      metrics.forEach(metric => {
        const observations = completed.map(run => run.metrics[metric.key]).filter(value => typeof value === 'number' && Number.isFinite(value));
        values[metric.key] = { value: reduce(observations, 'median'), n: observations.length,
          min: observations.length ? Math.min(...observations) : null,
          max: observations.length ? Math.max(...observations) : null };
      });
      cells.push({ id: key(xvalue) + '|' + key(yvalue), x: xvalue, y: yvalue, runs, completed, values,
        failed: runs.length - completed.length, timeLimit: runs.some(run => run.meta.timeLimit),
        warning: runs.some(run => run.meta.warning), jointFailed: completed.some(run => run.meta.jointPass === false),
        status: !runs.length ? 'untested' : !completed.length ? 'failed' : 'completed' });
    }));
    return { collection, selected, xvalues, yvalues, cells, tested: cells.filter(cell => cell.runs.length).length,
      completed: selected.filter(run => run.meta.state === 'completed').length };
  }

  function colorRange(metric, view, mode) {
    const values = (mode === 'slice' ? view.selected : view.collection)
      .filter(run => run.meta.state === 'completed').map(run => run.metrics[metric]);
    const numbers = values.filter(value => typeof value === 'number' && Number.isFinite(value));
    if (!numbers.length) return [0, 1];
    if (mode === 'slice') {
      const minimum = Math.min(...numbers);
      const maximum = Math.max(...numbers);
      const pad = minimum === maximum ? Math.max(Math.abs(minimum) * .05, 1) : 0;
      return [Math.max(0, minimum - pad), maximum + pad];
    }
    const maximum = Math.max(...numbers);
    if (metric === 'runtime') return [0, Math.max(15, Math.ceil(maximum / 5) * 5)];
    if (metric === 'waste') return [0, Math.max(10, Math.ceil(maximum / 10) * 10)];
    if (metric === 'ratio') return [0, Math.max(20, Math.ceil(maximum / 5) * 5)];
    const minimum = Math.floor(Math.min(...numbers) / 10) * 10;
    return [minimum, Math.max(minimum + 10, Math.ceil(maximum / 10) * 10)];
  }

  function color(value, range) {
    const fraction = Math.max(0, Math.min(1, (value - range[0]) / (range[1] - range[0])));
    const position = fraction * (palette.length - 1);
    const index = Math.min(palette.length - 2, Math.floor(position));
    const weight = position - index;
    const start = palette[index].match(/[a-f0-9]{2}/gi).map(channel => parseInt(channel, 16));
    const finish = palette[index + 1].match(/[a-f0-9]{2}/gi).map(channel => parseInt(channel, 16));
    return '#' + start.map((channel, channelIndex) => Math.round(channel * (1 - weight) + finish[channelIndex] * weight).toString(16).padStart(2, '0')).join('');
  }

  function contrast(background) {
    const channels = background.match(/[a-f0-9]{2}/gi).map(channel => parseInt(channel, 16) / 255);
    const linear = channels.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    const luminance = linear.reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
    return 1.05 / (luminance + .05) > (luminance + .05) / .05 ? '#ffffff' : '#162b40';
  }

  function escape(value) {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function number(value, metric) {
    if (value === null) return 'NA';
    return metric === 'latent' ? Number.isInteger(value) ? String(value) : value.toFixed(1) : value.toFixed(1);
  }

  function chart(metric, view, state) {
    const markColumns = count => Math.min(4, Math.ceil(Math.sqrt(Math.max(1, count))));
    const padding = { left: state.y === 'epsilon' ? 205 : 108, right: 22, top: 20, bottom: state.x === 'epsilon' ? 115 : 85 };
    const widths = view.xvalues.map(value => Math.max(state.x === 'epsilon' ? 160 : 80, ...view.cells.filter(cell => key(cell.x) === key(value)).map(cell => markColumns(cell.runs.length) * 62 + 16)));
    const heights = view.yvalues.map(value => Math.max(98, ...view.cells.filter(cell => key(cell.y) === key(value)).map(cell => Math.ceil(Math.max(1, cell.runs.length) / markColumns(cell.runs.length)) * 62 + 36)));
    const sum = values => values.reduce((total, value) => total + value, 0);
    const minimumWidth = 530 - padding.left - padding.right;
    const minimumHeight = 330 - padding.top - padding.bottom;
    const widthPad = Math.max(0, minimumWidth - sum(widths)) / widths.length;
    const heightPad = Math.max(0, minimumHeight - sum(heights)) / heights.length;
    widths.forEach((value, index) => { widths[index] = value + widthPad; });
    heights.forEach((value, index) => { heights[index] = value + heightPad; });
    const width = padding.left + padding.right + sum(widths);
    const height = padding.top + padding.bottom + sum(heights);
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const xpos = index => padding.left + sum(widths.slice(0, index)) + widths[index] / 2;
    const ypos = index => padding.top + plotHeight - sum(heights.slice(0, index)) - heights[index] / 2;
    const radius = 24;
    const range = colorRange(metric.key, view, state.scale);
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" class="metric-svg" data-metric="${metric.key}" role="img" aria-label="${escape(metric.title)} by selected X and Y parameters" style="font-family:Arial,sans-serif;background:#fff;width:${width}px;min-width:${width}px;max-width:none">`];
    parts.push(`<defs><linearGradient id="gradient-${metric.key}">${palette.map((entry, index) => `<stop offset="${index / (palette.length - 1) * 100}%" stop-color="${entry}"/>`).join('')}</linearGradient></defs>`);
    view.yvalues.forEach((value, index) => {
      const position = ypos(index);
      parts.push(`<line x1="${padding.left}" y1="${position}" x2="${width-padding.right}" y2="${position}" stroke="#edf1f4" stroke-width="1"/>`);
      const label = format(value);
      parts.push(`<text x="${padding.left-14}" y="${position+4}" font-size="11" text-anchor="end" fill="#48566a"><title>${escape(label)}</title>${escape(label.length > 25 ? label.slice(0, 23)+'…' : label)}</text>`);
    });
    view.xvalues.forEach((value, index) => {
      const position = xpos(index);
      const label = format(value);
      const rotate = label.length > 7;
      parts.push(`<text transform="translate(${position},${padding.top+plotHeight+22})${rotate?' rotate(-25)':''}" font-size="11" text-anchor="${rotate?'end':'middle'}" fill="#48566a"><title>${escape(label)}</title>${escape(label.length > 20 ? label.slice(0, 18)+'…' : label)}</text>`);
    });
    view.cells.forEach((cell, cellIndex) => {
      if (cell.status === 'untested' && !state.untested) return;
      const centerX = xpos(view.xvalues.findIndex(value => key(value) === key(cell.x)));
      const centerY = ypos(view.yvalues.findIndex(value => key(value) === key(cell.y)));
      const marks = cell.runs.length ? cell.runs : [null];
      const columns = markColumns(marks.length);
      const localRows = Math.ceil(marks.length / columns);
      if (cell.runs.length) {
        const coordinates = `${format(cell.x)} / ${format(cell.y)}`;
        const caption = coordinates.length > 30 ? coordinates.slice(0, 28) + '…' : coordinates;
        parts.push(`<text x="${centerX}" y="${centerY-localRows*31-5}" text-anchor="middle" font-size="10" fill="#64788a"><title>${escape(coordinates)}</title>${escape(caption)} · ${cell.runs.length} run${cell.runs.length === 1 ? '' : 's'}</text>`);
      }
      marks.forEach((run, runIndex) => {
        const localColumns = Math.min(columns, marks.length - Math.floor(runIndex / columns) * columns);
        const markX = centerX + ((runIndex % columns) - (localColumns - 1) / 2) * 62;
        const markY = centerY + (Math.floor(runIndex / columns) - (localRows - 1) / 2) * 62;
        const failed = run && run.meta.state !== 'completed';
        const measurement = run && !failed ? run.metrics[metric.key] : null;
        const fill = failed ? '#fff0e8' : measurement === null ? '#f9fafc' : color(measurement, range);
        const stroke = failed || run?.meta.jointPass === false ? '#bd612b' : !run ? '#d5dde6' : '#ffffff';
        const foreground = measurement === null ? '#98552e' : contrast(fill);
        const value = !run ? '—' : failed ? (run.meta.state === 'external_timeout' ? 'STOP' : 'FAIL') : number(measurement, metric.key);
        const symbols = run ? [run.meta.timeLimit ? '!' : '', run.meta.warning ? '†' : '', run.params.workflow === 'PFD only' ? 'PFD' : ''].filter(Boolean).join(' ') : '';
        const accessible = `${format(cell.x)}, ${format(cell.y)}: ${value} ${metric.unit}; ${run ? run.id + '; ' + run.meta.state : 'untested'}`;
        parts.push(`<g class="plot-point" data-cell="${cellIndex}" data-run="${run ? runIndex : -1}" data-status="${run ? escape(run.meta.state) : 'untested'}" tabindex="0" role="button" aria-label="${escape(accessible)}" style="cursor:pointer">`);
        const attributes = `fill="${fill}" stroke="${stroke}" stroke-width="${failed || run?.meta.jointPass === false ? 2 : 1.2}" ${!run ? 'stroke-dasharray="3 4"' : ''}`;
        parts.push(state.shape === 'circle' ? `<circle cx="${markX}" cy="${markY}" r="${radius}" ${attributes}/>` : `<rect x="${markX-radius-4}" y="${markY-radius}" width="${radius*2+8}" height="${radius*2}" rx="8" ${attributes}/>`);
        parts.push(`<text x="${markX}" y="${markY+(symbols ? 0 : 5)}" text-anchor="middle" font-size="${value.length>5 ? 11 : 13}" font-weight="600" fill="${foreground}">${escape(value)}</text>`);
        if (symbols) parts.push(`<text x="${markX}" y="${markY+14}" text-anchor="middle" font-size="9" fill="${foreground}">${escape(symbols)}</text>`);
        parts.push('</g>');
      });
    });
    const xlabel = dimensions.find(item => item.key === state.x).label;
    const ylabel = dimensions.find(item => item.key === state.y).label;
    parts.push(`<text x="${padding.left+plotWidth/2}" y="${height-12}" text-anchor="middle" font-size="12" fill="#263e56">${escape(xlabel)}</text>`);
    parts.push(`<text transform="translate(18,${padding.top+plotHeight/2}) rotate(-90)" text-anchor="middle" font-size="12" fill="#263e56">${escape(ylabel)}</text>`);
    parts.push('</svg>');
    const layout = {
      padding, plotWidth, plotHeight,
      xTicks: view.xvalues.map((value, index) => ({ value, position: xpos(index) - padding.left, start: sum(widths.slice(0, index)), end: sum(widths.slice(0, index + 1)) })),
      yTicks: view.yvalues.map((value, index) => ({ value, position: ypos(index) - padding.top, start: ypos(index) - padding.top - heights[index] / 2, end: ypos(index) - padding.top + heights[index] / 2 }))
    };
    return { svg: parts.join(''), width, height, range, layout };
  }

  function csv(rows, fields) {
    const quote = value => {
      if (value === null || value === undefined) return '';
      const text = String(value);
      const safe = /^[=+@\-]/.test(text) && typeof value !== 'number' ? "'" + text : text;
      return '"' + safe.replace(/"/g, '""') + '"';
    };
    return [fields.map(quote).join(','), ...rows.map(row => fields.map(field => quote(row[field])).join(','))].join('\r\n');
  }

  return { dimensions, activeDimensions, parameter, metrics, palette, key, format, unique, scopeRuns, representative, defaultState,
    setAxes, validateState, matches, reduce, collect, colorRange, color, contrast, escape, number, chart, csv };
});
