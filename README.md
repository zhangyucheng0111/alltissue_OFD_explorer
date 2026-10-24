# Offline Young AllTissue parameter explorer

This isolated web artifact starts from 279 historical attempts and appends
finished supplemental epsilon / ATPm attempts from `all_attempts.tsv`. It reads recorded results
only. Building or opening the page never runs MATLAB, Gurobi, or any model and
does not change source experiments, production code, or the atlas.

## Open offline

After building, open `index.html` directly in a browser, including from a copied
folder or an offline computer. The HTML embeds its styles, data, plotting core,
and application code. It needs no server, package installation, network access,
or fetching of `data.json`. That JSON is also exported for inspection.

## Three controls

1. **X parameter:** choose the recorded parameter to vary horizontally.
2. **Y parameter:** choose a second, different parameter to vary vertically.
   Four panels always show fit minutes, bacterial waste (%), actual ATPm/BAC
   uptake ratio, and latent reactions fitted for the same parameter pairs.
3. **Fixed conditions:** always-visible selectors offer a specific value or
   **All values (not fixed)** for every non-axis biological/algorithm parameter.
   Six dimensions are available: ATPm, BAC coefficient, exchange coefficient,
   the recorded epsilon0–k pair, extra warm start, and hard low constraint.
   Threads, solver seed, workflow type and historical version never filter or
   split the view. They remain in original records and Excel provenance.

All recorded runs appear by default. The original 279 include 63 failures and 3 external stops. There
is no historical/current workflow grouping. Choosing a fixed condition narrows
the view; **Show all runs** resets all non-axis conditions to All values.
Epsilon options contain only pairs actually recorded, never an invented Cartesian
product of epsilon0 and k. Either axis may also use the combined epsilon pair.
Old version-1/2 saved views reset to the new all-runs default on first opening;
version-3 URLs preserve the six-dimension settings.
Circles and rounded tiles encode each outcome with both color and a numeric value;
mark size is constant. Every original run has its own mark, even when several
runs share the same parameter pair. Small offsets arrange those runs within the
same parameter cell; offsets have no quantitative meaning. No mean or median is
plotted. Hover or click a mark for that run's values, status and provenance.
FAIL marks failed attempts, STOP external stops, NA missing outcomes, and —
untested coordinates. A failed attempt remains visible beside successful attempts
at the same pair. PFD-only runs remain visible; missing latent counts stay NA.
Each outcome occupies its own full-width row. Plots scroll horizontally and
vertically inside a bounded viewport. The X ticks below and Y ticks to the left
are separate, fixed rails: their readable labels update as the plot is panned,
including when a large parameter cell extends beyond the viewport. Zoom using
the slider, − / +, 100%, Fit width, Fit all, or Ctrl/Command + wheel. Zoom and
panning are linked across all four outcomes. Axis text keeps a fixed screen
size while marks scale. At small zoom levels, crowded tick labels are thinned;
zoom back in for detail. The initial viewport centers on the most-sampled
parameter cell; it does not filter out off-screen runs. SVG/PNG exports also
use one outcome per row and include the full selected parameter grid and axes,
not just the visible scroll region or current zoom.
Axis levels are sampled categories, not continuous distances; spacing also adapts
to the number of marks in each row/column. Zero-match selections are explicit.

Export the four panels as one SVG or PNG, or matching raw records as
CSV. Copy view link preserves axes, conditions, and display options in the URL
fragment; opening that link elsewhere requires access to the same HTML file.

Every plotted value comes from one original attempt. There is no interpolation,
extrapolation, averaging, or prediction. Outcomes are numeric only for returned
runs with finite recorded values. Missing and failed outcomes never become zero.
All-values conditions allow other parameters to vary and must not be interpreted
as holding those parameters fixed. Combining code versions, seeds, threads and
PFD/OFD runs is an overview, not a controlled speed or robustness comparison.

## Recorded provenance

The `final` scope contains exactly 19 runs from
`robustOFD_20261022_integerLock` and `robustOFD_20261022_validation`, with policy
`Integer-lock fix; total-flux gap 1e-4`. These scope labels are retained as metadata,
not used for filtering or plot grouping.
Nonfinal policies preserve the row's actual policy, or `Historical original`
when it was not recorded. Original protocol and unique run IDs remain available.

Effective epsilon values are numeric and explicitly mapped from known filenames,
overriding nominal TSV values where needed:

| File or suffix | Effective epsilon0 | Effective k |
| --- | --- | --- |
| `epsilon_e001_k01.mat` | 0.01 | 0.1 |
| `e0005` / `e0001` / `e0009` / `e0011` | 0.005 / 0.001 / 0.009 / 0.011 | encoded k |
| `k05` / `k009` / `k011` | encoded epsilon0 | 0.5 / 0.09 / 0.11 |
| `epsilon_scale_2of5p5.mat` | 0.01 × 2/5.5 | 0.1 × 2/5.5 |
| `epsilon_scale_e095.mat` / `epsilon_scale_e105.mat` | scaled epsilon0 × 0.95 / 1.05 | scaled k |
| `epsilon_scale_k095.mat` / `epsilon_scale_k105.mat` | scaled epsilon0 | scaled k × 0.95 / 1.05 |

The neighbor files use the scaled 2/5.5 baseline, independently of the run's
ATPm setting. Unknown filenames use finite explicit TSV epsilon0/k values or
null. The payload includes the mapping and provenance note; no epsilon MAT file
is opened. BAC and exchange are `off` only when their minimization switch is
disabled. Enabled coefficients prefer effective values over nominal ones.
Threads prefer `actual_threads`, then `threads`, otherwise null.

`manifest.json` records SHA-256 hashes for the input TSV, builder, README, and all
four frontend source files, plus hashes for `data.json` and `index.html`.
`meta.sources` identifies the actual consumed TSV; per-run source references
preserve the original table's provenance, with the consumed TSV as fallback.
Those referenced upstream files are not additional build inputs.

## Quality caveats

Completed means a workflow returned; it does not prove that every solver stage
was optimal. TIME_LIMIT evidence is combined across counters, flags, and stage
status/log columns, even if the last solve was optimal. Numerical-warning
evidence is retained separately. Validation and joint-pass flags remain null
where unrecorded; absence is not a pass. Validation, joint pass, completion,
warnings, and solver limits answer different questions.

The runtime metric uses only the recorded `fit_min`; fit elapsed seconds and
whole-workflow seconds are kept separately and must not be treated as the same
timing boundary. PFD-only attempts remain distinct from OFD attempts. Historical
code, policies, solver behavior, and seed coverage can differ between scopes.
These sparse observations describe recorded experiments, not a continuous
response surface or a proof of biological validity. Review quality flags before
interpreting an aggregate, particularly when all seeds are selected.

## Build and refresh

Python 3 with its standard library is sufficient. Wait until `template.html`,
`styles.css`, `plot_core.js`, and `app.js` exist beside the builder, then run:

```sh
python3 build_site.py
```

The template must contain exactly one each of `__STYLE__`, `__DATA__`, `__CORE__`,
and `__APP__`. The builder substitutes the corresponding file contents and
script-safe embedded JSON, then writes `index.html`, `data.json`, and
`manifest.json` in this directory. It never overwrites the frontend sources.
Missing frontend files or invalid data stop the build before outputs are written.

To refresh from an explicitly selected TSV with the same schema:

```sh
python3 build_site.py --source /absolute/path/to/all_279_attempts.tsv
```

Paths are resolved independently of the calling directory. Refresh requires at
least the 279 historical attempts, unique run IDs, and 19 original final-scope
runs. Supplemental attempts retain their own protocol. A successful refresh updates all three generated files
and their timestamp and checksums. Reopen or reload the HTML afterward.

For data-only validation before frontend files are ready, import
`build_site.build_payload()` from this directory. It validates and returns the
JSON-native payload without writing any files.

## Validation

`node validate_core.js` runs 260 checks: all original IDs, paired epsilon
filtering, all 30 ordered axis combinations, individual finite SVG marks,
no thread/workflow/seed/version filtering, fixed-axis geometry for every axis
pair and outcome, and all 63 failures plus 3 stops.
`validate_browser.py` exercises the generated file directly using a local
Firefox WebDriver on port 48391. It checks controls, URL restoration, four-panel
rendering, raw-record inspection, mobile layout, and exports. It also checks
single-column full-width cards, external fixed rails, synchronized zoom/pan,
slider and Ctrl-wheel zoom, Fit width/Fit all, and paired-epsilon tick labels.
The page has been checked in headless Firefox; SVG, PNG, and CSV downloads were
produced successfully. These browser tools are only for development, not needed
to open or use the website. No metabolic-model calculations are performed.

## Complete Excel workbook

The supplemental scan appends only finished attempts and updates `scan_status.json`.
The website embeds a progress summary; reopening/reloading displays the latest
local build. It never connects to MATLAB and cannot run a model from a browser.
The 72-case matrix uses four epsilon pairs (0.005/0.5, 0.005/0.1, 0.001/0.5,
0.001/0.1), minBAC=1.1, warm+hard on, exchange off, and all 18 previously
recorded ATPm/tissue values. GitHub Pages changes only after you publish updates.

`all_runs_parameters_results.xlsx` contains every recorded attempt, not just the
current plot selection. Its six sheets are:

- **All runs:** all historical and finished supplemental rows, 63 readable normalized parameter/result/quality fields.
- **Parameters:** the same runs with only parameter, version, and provenance fields.
- **Results:** the same runs with outcomes, solver quality, and stage diagnostics.
- **Raw source:** all original TSV fields plus supplemental fields retained as text, including every
  available tissue flux and stage timing. Partial results are not discarded.
- **Workflows:** coverage, returned/failure counts and warning counts by version.
- **Notes:** units, timing boundaries, missing-value and quality interpretation.

Headers and identifier columns are frozen; filters are enabled. The main numeric
views use typed numbers and Boolean values. Orange reference highlighting marks
time >15 minutes, waste >10%, and ATPm/BAC outside 10–20. Blank means missing or
not applicable, not zero. Failed workflows do not show partial values as final
outcomes. The raw-source sheet preserves all original recorded observations.

Refresh after rebuilding the website data with:

```sh
python3 export_excel.py
```

The exporter uses only Python's standard library, writes a real `.xlsx` package,
and requires no model computations or installed spreadsheet library. Keep the
workbook beside `index.html` for the website's full Excel download link to work.
