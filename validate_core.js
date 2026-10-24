'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('./plot_core.js');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json')));
let checks = 0;
function verify(condition, message) { assert(condition, message); checks += 1; }
const state = core.defaultState(data, 'auto');
const view = core.collect(data, state);
verify(data.runs.length >= 279 && new Set(data.runs.map(run => run.id)).size === data.runs.length, 'Historical and supplemental runs have unique IDs');
verify(view.selected.length === data.runs.length && view.completed === data.runs.filter(run => run.meta.state === 'completed').length, 'All runs, including failures, shown by default');
verify(view.cells.reduce((count, cell) => count + cell.failed, 0) === data.runs.filter(run => run.meta.state !== 'completed').length, 'No failed or interrupted attempts hidden');
verify(core.dimensions.length === 6 && !core.dimensions.some(dimension => ['threads', 'workflow', 'seed', 'policy', 'epsilon0', 'k'].includes(dimension.key)), 'Only six user-facing dimensions');
verify(!view.groups, 'No historical/current workflow grouping');
verify(view.cells.some(cell => new Set(cell.runs.map(run => run.protocol)).size > 1), 'Versions appear together at matching coordinates');
const counts = new Map();
for (const cell of view.cells) for (const run of cell.runs) counts.set(run.id, (counts.get(run.id) || 0) + 1);
verify(counts.size === data.runs.length && [...counts.values()].every(count => count === 1), 'Every original run appears exactly once per panel');
const pairs = core.unique(data.runs.map(run => core.parameter(run, 'epsilon')));
verify(pairs.length > 5 && pairs.every(pair => JSON.parse(pair).length === 2), 'Epsilon selector contains recorded pairs only');
const scaled = JSON.stringify([0.01 * 2 / 5.5, 0.1 * 2 / 5.5]);
const actualScaled = pairs.find(pair => Math.abs(JSON.parse(pair)[0] - JSON.parse(scaled)[0]) < 1e-14 && Math.abs(JSON.parse(pair)[1] - JSON.parse(scaled)[1]) < 1e-14);
const fixed = { ...state, pins: { exchange: 'off', epsilon: actualScaled, warm: 'On', hard: 'On' } };
const fixedView = core.collect(data, fixed);
verify(fixedView.selected.length === 14, 'Exact biological-condition filtering');
verify(fixedView.selected.every(run => core.parameter(run, 'epsilon') === actualScaled), 'Epsilon pair never split or fabricated');
const modifiedData = structuredClone(data);
modifiedData.runs.forEach(run => { run.params.threads = 999; run.params.seed = 999; run.params.workflow = 'arbitrary'; run.scope = 'different'; run.params.policy = 'different'; });
verify(core.collect(modifiedData, fixed).selected.length === fixedView.selected.length, 'Thread, seed, workflow, policy and scope do not filter');
const swapped = core.collect(data, core.setAxes(fixed, state.y, state.x, data.runs));
verify(JSON.stringify(swapped.selected.map(run => run.id).sort()) === JSON.stringify(fixedView.selected.map(run => run.id).sort()), 'Axis swap preserves records');
verify(!core.validateState({ ...state, y: state.x }, data), 'Identical axes rejected');
verify(!core.validateState({ ...fixed, pins: { ...fixed.pins, epsilon: '[99,99]' } }, data), 'Unknown epsilon pair rejected');
const record = structuredClone(data.runs[0]);
record.meta.state = 'failed'; record.metrics.runtime = 123;
const failedData = { ...data, runs: [record] };
const failedView = core.collect(failedData, core.defaultState(failedData, 'auto'));
const failedChart = core.chart(core.metrics[0], failedView, state).svg;
verify(failedChart.includes('FAIL') && !failedChart.includes('123.0'), 'Failed partial output never rendered as final value');
record.meta.state = 'external_timeout';
verify(core.chart(core.metrics[0], core.collect(failedData, state), state).svg.includes('STOP'), 'External stop labeled separately');
verify(core.csv([{ value: '=1+2' }], ['value']).includes("'=1+2"), 'CSV formula escaping');
verify(core.escape('<script>') === '&lt;script&gt;', 'Markup escaping');
for (const xaxis of core.dimensions) for (const yaxis of core.dimensions) {
  if (xaxis.key === yaxis.key) continue;
  const selectedState = core.setAxes(state, xaxis.key, yaxis.key, data.runs);
  const selectedView = core.collect(data, selectedState);
  for (const metric of core.metrics) {
    const chart = core.chart(metric, selectedView, selectedState);
    const marks = [...chart.svg.matchAll(/data-run="(\d+)"/g)];
    verify(marks.length === selectedView.selected.length && !/NaN|Infinity/.test(chart.svg), `Individual finite marks: ${xaxis.key}/${yaxis.key}/${metric.key}`);
    verify(chart.layout.plotWidth > 0 && chart.layout.plotHeight > 0 && chart.layout.xTicks.length === selectedView.xvalues.length && chart.layout.yTicks.length === selectedView.yvalues.length && [...chart.layout.xTicks, ...chart.layout.yTicks].every(tick => Number.isFinite(tick.position) && tick.start <= tick.position && tick.position <= tick.end), `Fixed-axis geometry: ${xaxis.key}/${yaxis.key}/${metric.key}`);
  }
}
const fullChart = core.chart(core.metrics[0], view, state).svg;
verify((fullChart.match(/data-status="failed"/g) || []).length === data.runs.filter(run => run.meta.state === 'failed').length, 'All failures visible in the plot');
verify((fullChart.match(/data-status="external_timeout"/g) || []).length === data.runs.filter(run => run.meta.state === 'external_timeout').length, 'All external stops visible in the plot');
console.log(`${checks} checks passed; ${data.runs.length} individual runs; 30 ordered axis combinations; no historical grouping.`);
