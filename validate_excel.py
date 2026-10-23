"""Check both the delivered workbook and an optional independent office roundtrip."""
import csv
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
from zipfile import ZipFile

SITE = Path(__file__).resolve().parent
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def read_workbook(path):
    sheets = []
    with ZipFile(path) as archive:
        assert archive.testzip() is None
        for name in archive.namelist():
            if name.endswith(('.xml', '.rels')):
                ET.fromstring(archive.read(name))
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            strings = [''.join(item.itertext()) for item in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si', NS)]
        book = ET.fromstring(archive.read('xl/workbook.xml'))
        for index, info in enumerate(book.findall('s:sheets/s:sheet', NS), 1):
            sheet = ET.fromstring(archive.read(f'xl/worksheets/sheet{index}.xml'))
            rows = []
            for row in sheet.findall('s:sheetData/s:row', NS):
                cells = {}
                for cell in row.findall('s:c', NS):
                    address = cell.attrib['r']
                    value = cell.find('s:v', NS)
                    text = None if value is None else value.text
                    if cell.attrib.get('t') == 'inlineStr':
                        text = ''.join(cell.find('s:is', NS).itertext())
                    elif cell.attrib.get('t') == 's':
                        text = strings[int(text)]
                    elif cell.attrib.get('t') == 'b':
                        text = text == '1'
                    elif text is not None:
                        text = float(text)
                    if text is not None:
                        cells[''.join(character for character in address if character.isalpha())] = text
                rows.append(cells)
            sheets.append((info.attrib['name'], rows))
    return dict(sheets)


def column(index):
    result = ''
    while index:
        index, remainder = divmod(index - 1, 26)
        result = chr(65 + remainder) + result
    return result


data = json.loads((SITE / 'data.json').read_text())
source = Path(data['meta']['sources'][0]['path'])
with source.open(newline='', encoding='utf-8-sig') as handle:
    reader = csv.reader(handle, delimiter='\t')
    expected = list(reader)
for filename in [SITE / 'all_runs_parameters_results.xlsx', *map(Path, sys.argv[1:])]:
    workbook = read_workbook(filename)
    assert len(workbook) == 6
    for name in ['All runs', 'Parameters', 'Results', 'Raw source']:
        assert len(workbook[name]) == 280, (name, len(workbook[name]))
    actual_ids = [row['A'] for row in workbook['All runs'][1:]]
    assert actual_ids == [run['id'] for run in data['runs']]
    for row_number, fields in enumerate(expected):
        row = workbook['Raw source'][row_number]
        for index, text in enumerate(fields, 1):
            assert row.get(column(index), '') == text, (row_number, index)
    normalized = workbook['All runs']
    lookup = {value: key for key, value in normalized[0].items()}
    for row, run in zip(normalized[1:], data['runs']):
        for title, metric in [('Fit minutes', 'runtime'), ('Waste percent', 'waste'), ('Actual ATPm per BAC', 'ratio'), ('Latent fitted', 'latent')]:
            value = row.get(lookup[title])
            expected_value = run['metrics'][metric] if run['meta']['state'] == 'completed' else None
            if expected_value is None:
                assert value is None, (run['id'], title)
            else:
                assert abs(value - expected_value) < 1e-8 * max(1, abs(expected_value)), (run['id'], title)
    print(f'PASS {filename}: 6 sheets, all 279 IDs, 190 raw fields verified cell by cell; numeric outcomes and failed-run blanks match.')
