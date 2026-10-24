"""Export every recorded attempt to a styled, filterable Office Open XML workbook."""
import csv
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED

SITE = Path(__file__).resolve().parent
NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
MISSING = {"", "na", "nan", "none", "null", "n/a", "<na>", "[]"}


def column_name(index):
    result = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        result = chr(65 + remainder) + result
    return result


def typed(value):
    if value is None or str(value).strip().lower() in MISSING:
        return None
    text = str(value).strip()
    if text.lower() in {"true", "false"}:
        return text.lower() == "true"
    if re.fullmatch(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?", text):
        number = float(text)
        if math.isfinite(number):
            return int(number) if number.is_integer() else number
    return text


def cell(address, value, header=False):
    style = 1 if header else 2 if isinstance(value, (int, float)) and not isinstance(value, bool) else 0
    if value is None:
        return f'<c r="{address}" s="0"/>'
    if isinstance(value, bool):
        return f'<c r="{address}" t="b"><v>{int(value)}</v></c>'
    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            raise ValueError("Non-finite Excel value")
        return f'<c r="{address}" s="{style}"><v>{value}</v></c>'
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", str(value))
    if len(text) > 32767:
        raise ValueError(f"Cell {address} exceeds the Excel text limit")
    return f'<c r="{address}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{escape(text)}</t></is></c>'


def sheet_xml(headers, rows, fixed=3, conditional=None):
    end = f"{column_name(len(headers))}{len(rows) + 1}"
    width_specs = []
    for index, title in enumerate(headers, 1):
        width = min(36, max(15, len(title) + 2))
        if title in {"Run ID", "Source", "Error", "Protocol", "Numerical policy"}:
            width = 42
        width_specs.append(f'<col min="{index}" max="{index}" width="{width}" customWidth="1"/>')
    parts = [f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="{NS}"><dimension ref="A1:{end}"/><sheetViews><sheetView workbookViewId="0"><pane xSplit="{fixed}" ySplit="1" topLeftCell="{column_name(fixed + 1)}2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="19"/><cols>{"".join(width_specs)}</cols><sheetData>']
    for row_number, values in enumerate([headers, *rows], 1):
        parts.append(f'<row r="{row_number}"' + (' ht="34" customHeight="1"' if row_number == 1 else '') + '>')
        parts.extend(cell(f"{column_name(index)}{row_number}", value, row_number == 1) for index, value in enumerate(values, 1))
        parts.append('</row>')
    parts.append(f'</sheetData><autoFilter ref="A1:{end}"/>')
    for priority, (title, expression) in enumerate(conditional or [], 1):
        index = headers.index(title) + 1
        coordinate = column_name(index)
        formula = expression.replace("CELL", coordinate + "2")
        parts.append(f'<conditionalFormatting sqref="{coordinate}2:{coordinate}{len(rows) + 1}"><cfRule type="expression" dxfId="0" priority="{priority}"><formula>{escape(formula)}</formula></cfRule></conditionalFormatting>')
    parts.append('<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>')
    return ''.join(parts)


def main():
    payload = json.loads((SITE / 'data.json').read_text())
    source = Path(payload['meta']['sources'][0]['path'])
    with source.open(newline='', encoding='utf-8-sig') as handle:
        reader = csv.DictReader(handle, delimiter='\t')
        raw_headers = reader.fieldnames
        raw_rows = list(reader)
    raw_by_id = {row['run_id']: row for row in raw_rows}
    headers = ['Run ID', 'Case', 'Status', 'ATPm per tissue', 'minBAC enabled', 'BAC coefficient', 'minExchange enabled', 'Exchange coefficient', 'Warm start', 'Hard low constraint', 'Epsilon0 effective', 'k effective', 'Seed', 'Threads', 'Workflow', 'Fit minutes', 'Waste percent', 'Actual ATPm per BAC', 'Latent fitted', 'BAC uptake', 'Actual total ATPm', 'Nfit score', 'High fitted', 'Zero fitted', 'minLow', 'minTotal', 'Final total flux', 'Final exchange flux', 'Stage time limit', 'Numerical warning', 'Validation passed', 'Joint acceptance', 'Failure stage', 'Error', 'To failure seconds', 'Workflow seconds', 'storeProp', 'SideProp', 'doMinPFD', 'doLatent', 'latentCAP', 'speedMode', 'minLowTol', 'bacLim', 'modelType', 'BAC reference', 'BAC cap', 'Exchange reference', 'Exchange cap', 'Latent cycles', 'Stage solve calls', 'Maximum solver violation', 'Mass balance violation', 'Bound violation', 'BAC cap violation', 'Exchange cap violation', 'Solver gap', 'Last solver status', 'Epsilon file', 'Protocol', 'Numerical policy', 'Code identity', 'Source']
    summary = []
    for run in payload['runs']:
        params, metrics, meta = run['params'], run['metrics'], run['meta']
        raw = raw_by_id[run['id']]
        def get(name):
            return typed(raw.get(name))
        returned = meta['state'] == 'completed'
        def result(name):
            return metrics[name] if returned else None
        prefix = 'OFD' if params['workflow'] == 'OFD' else 'PFD'
        values = [run['id'], run['case'], meta['state'], params['atpm'], params['bac'] != 'off', None if params['bac'] == 'off' else params['bac'], params['exchange'] != 'off', None if params['exchange'] == 'off' else params['exchange'], params['warm'], params['hard'], params['epsilon0'], params['k'], params['seed'], params['threads'], params['workflow'], result('runtime'), result('waste'), result('ratio'), result('latent'), meta['uptake'] if returned else None, meta['totalATPm'] if returned else None, meta['Nfit'], get('highFit'), get('zeroFit'), meta['minLow'], meta['minTotal'], get(prefix + '_totalFlux') if returned else None, meta['exchangeFlux'] if returned else None, meta['timeLimit'], meta['warning'], meta['validation'], meta['jointPass'], meta['failureStage'], meta['error'], get('failed_elapsed_s'), meta['workflowSeconds'], get('storeProp'), get('SideProp'), get('doMinPFD'), get('doLatent'), get('latentCAP'), get('speedMode'), get('minLowTol'), get('bacLim'), get('modelType'), get('bac_reference'), get('bac_cap'), get('exchange_reference'), get('exchangeCap'), get('latent_cycles'), get('solve_calls') if get('solve_calls') is not None else get('solver_calls'), get('max_reported_solver_violation'), get(prefix + '_massViolation'), get(prefix + '_boundViolation'), get(prefix + '_bacCapViolation'), get(prefix + '_exchangeViolation'), get('last_solver_mipgap'), get('last_solver_status'), meta['epsilonFile'], run['protocol'], params['policy'], get('historical_code_identity'), meta['source']]
        assert len(values) == len(headers)
        summary.append(values)
    params_fields = headers[:15] + headers[36:45] + ['Epsilon file', 'Protocol', 'Numerical policy', 'Code identity', 'Source']
    result_fields = headers[:4] + headers[15:36] + headers[45:58] + ['Protocol', 'Numerical policy']
    def select(fields):
        return [[row[headers.index(field)] for field in fields] for row in summary]
    workflow_rows = []
    for scope in payload['scopes']:
        runs = [run for run in payload['runs'] if run['scope'] == scope['id']]
        workflow_rows.append([scope['id'], len(runs), sum(run['meta']['state'] == 'completed' for run in runs), sum(run['meta']['state'] != 'completed' for run in runs), sum(run['meta']['timeLimit'] for run in runs), sum(run['meta']['warning'] for run in runs), scope['description']])
    notes = [
        ['Coverage', f'{len(summary)} attempts, including completed, failed and interrupted runs; one row per original run ID.'],
        ['Generated UTC', datetime.now(timezone.utc).isoformat()],
        ['Source TSV', str(source)],
        ['Source SHA256', hashlib.sha256(source.read_bytes()).hexdigest()],
        ['All runs', 'Readable normalized parameters and results. Filters enabled; first three columns and header frozen.'],
        ['Parameters / Results', f'Alternative views of the same {len(summary)} runs, not additional attempts.'],
        ['Raw source', 'Every original TSV field, verbatim text. Empty cells remain empty. Includes stage timings, tissue fluxes and all available quality fields.'],
        ['Missing values', 'Blank means missing or not recorded, not zero. Disabled coefficients are blank, with their enabled flag false.'],
        ['Failed runs', 'Final four outcome metrics, final uptake and total ATPm are blank for workflows that did not return. Partial stage observations remain labeled by run status; raw source retains all evidence.'],
        ['ATPm per tissue', 'A lower-bound parameter for each of seven tissue maintenance reactions; not the measured total ATPm.'],
        ['Actual ATPm per BAC', 'Actual final total ATPm divided by positive bacterial uptake.'],
        ['Fit minutes', 'Recorded fit_min. Not MATLAB startup time; not a replacement for whole-workflow timing.'],
        ['Stage time limit', 'A returned time-limited incumbent does not prove stage optimality.'],
        ['Numerical warning', 'Warnings and validation are distinct. An absent validation flag is not a pass.'],
        ['Version comparability', 'Workflow protocols and numerical policies are recorded. Do not pool evolving formulations simply because biological parameters match.'],
        ['Reference highlighting', 'Orange fill indicates fit time >15 min, waste >10%, or ATPm/BAC outside 10–20. These are project screening references, not universal physiological limits.'],
        ['Effective epsilon', payload['meta']['epsilonProvenance']],
    ]
    sheets = [
        ('All runs', headers, summary, [('Fit minutes', 'AND(ISNUMBER(CELL),CELL>15)'), ('Waste percent', 'AND(ISNUMBER(CELL),CELL>10)'), ('Actual ATPm per BAC', 'AND(ISNUMBER(CELL),OR(CELL<10,CELL>20))')]),
        ('Parameters', params_fields, select(params_fields), []),
        ('Results', result_fields, select(result_fields), []),
        ('Raw source', raw_headers, [[row[field] or None for field in raw_headers] for row in raw_rows], []),
        ('Workflows', ['Workflow group', 'Attempts', 'Returned', 'Failed or interrupted', 'Stage time limit', 'Numerical warning', 'Description'], workflow_rows, []),
        ('Notes', ['Topic', 'Explanation'], notes, []),
    ]
    styles = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="{NS}">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.########"/></numFmts>
<fonts count="2">
<font><color rgb="FF1E3449"/><sz val="11"/><name val="Arial"/></font>
<font><b/><color rgb="FF1E3449"/><sz val="11"/><name val="Arial"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8F0F7"/><bgColor rgb="FFE8F0F7"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor rgb="FFFFFFFF"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="3" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1" applyFont="1" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="1"><dxf><fill><patternFill patternType="solid"><fgColor rgb="FFFFE3C4"/><bgColor rgb="FFFFE3C4"/></patternFill></fill></dxf></dxfs>
</styleSheet>'''
    rel_ns = 'http://schemas.openxmlformats.org/package/2006/relationships'
    doc_rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    content = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + ''.join(f'<Override PartName="/xl/worksheets/sheet{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for index in range(1, len(sheets) + 1)) + '</Types>'
    output = SITE / 'all_runs_parameters_results.xlsx'
    temporary = output.with_suffix('.xlsx.tmp')
    with ZipFile(temporary, 'w', ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', content)
        archive.writestr('_rels/.rels', f'<Relationships xmlns="{rel_ns}"><Relationship Id="rId1" Type="{doc_rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        archive.writestr('xl/workbook.xml', f'<workbook xmlns="{NS}" xmlns:r="{doc_rel}"><bookViews><workbookView/></bookViews><sheets>' + ''.join(f'<sheet name="{name}" sheetId="{index}" r:id="rId{index}"/>' for index, (name, *_rest) in enumerate(sheets, 1)) + '</sheets></workbook>')
        archive.writestr('xl/_rels/workbook.xml.rels', f'<Relationships xmlns="{rel_ns}">' + ''.join(f'<Relationship Id="rId{index}" Type="{doc_rel}/worksheet" Target="worksheets/sheet{index}.xml"/>' for index in range(1, len(sheets) + 1)) + f'<Relationship Id="rId{len(sheets) + 1}" Type="{doc_rel}/styles" Target="styles.xml"/></Relationships>')
        archive.writestr('xl/styles.xml', styles)
        for index, (name, columns, rows, conditions) in enumerate(sheets, 1):
            archive.writestr(f'xl/worksheets/sheet{index}.xml', sheet_xml(columns, rows, min(3, len(columns) - 1), conditions))
    temporary.replace(output)
    print(f'Exported {len(summary)} attempts; {len(headers)} summary fields; {len(raw_headers)} raw fields; {len(sheets)} sheets: {output}')


if __name__ == '__main__':
    main()
