"""Exercise the offline page through a localhost Firefox WebDriver."""
import base64
import json
import time
from pathlib import Path
from urllib.request import Request, urlopen

SITE = Path(__file__).resolve().parent
DRIVER = "http://127.0.0.1:48391"


def request(method, endpoint, payload=None):
    body = None if payload is None else json.dumps(payload).encode()
    with urlopen(Request(DRIVER + endpoint, data=body, method=method, headers={"Content-Type": "application/json"}), timeout=120) as response:
        return json.load(response)["value"]


session = request("POST", "/session", {"capabilities": {"alwaysMatch": {
    "browserName": "firefox",
    "moz:firefoxOptions": {
        "binary": "/snap/firefox/current/usr/lib/firefox/firefox",
        "args": ["-headless"],
        "prefs": {"browser.download.folderList": 2, "browser.download.dir": "/tmp/alltissue-browser-downloads", "browser.download.useDownloadDir": True, "browser.helperApps.neverAsk.saveToDisk": "image/png,image/svg+xml,text/csv"},
    },
}}})["sessionId"]
prefix = "/session/" + session


def script(source):
    return request("POST", prefix + "/execute/sync", {"script": source, "args": []})


def check(source, message):
    assert script(source), message
    print("PASS", message)


try:
    request("POST", prefix + "/window/rect", {"width": 1440, "height": 1200})
    request("POST", prefix + "/url", {"url": (SITE / "index.html").as_uri()})
    check("return window.ParameterExplorer?.view.selected.length === 279 && document.querySelectorAll('.metric-svg').length === 4 && !document.getElementById('scope')", "All 279 runs in four panels by default")
    check("return document.querySelectorAll('[data-metric=\"runtime\"] [data-run]:not([data-run=\"-1\"])').length===279 && document.querySelectorAll('[data-metric=\"runtime\"] [data-status=\"failed\"]').length===63 && document.querySelectorAll('[data-metric=\"runtime\"] [data-status=\"external_timeout\"]').length===3", "Every failed and stopped run has an individual visible mark")
    check("return !document.querySelector('.workflow-heading') && !Array.from(document.querySelectorAll('#x-axis option')).some(option=>['threads','workflow','seed','epsilon0','k'].includes(option.value))", "No historical grouping or thread/workflow/seed axes")
    check("const cards=[...document.querySelectorAll('.chart-card')].map(node=>node.getBoundingClientRect());return cards.every((card,index)=>card.width>1200&&(!index||card.top>=cards[index-1].bottom))", "One full-width outcome per row")
    check("const rail=document.querySelector('.fixed-x-axis').getBoundingClientRect();const scroll=document.querySelector('.chart-scroll').getBoundingClientRect();const side=document.querySelector('.fixed-y-axis').getBoundingClientRect();return rail.top>=scroll.bottom-1&&side.right<=scroll.left+1&&rail.width>=scroll.width-2", "X and Y tick rails outside the scroll area")
    script("const slider=document.querySelector('.plot-zoom input');slider.value='50';slider.dispatchEvent(new Event('input'));")
    time.sleep(.15)
    check("return [...document.querySelectorAll('.plot-zoom output')].every(node=>node.textContent==='50%')&&[...document.querySelectorAll('.axis-layer')].every(node=>node.dataset.zoom==='0.5')", "Slider zoom linked across all four outcomes and axes")
    check("const svg=document.querySelector('.metric-svg');const box=svg.viewBox.baseVal;return Math.abs(svg.getBoundingClientRect().width-box.width*.5)<1&&Math.abs(svg.getBoundingClientRect().height-box.height*.5)<1", "Plot geometry scales correctly")
    script("document.querySelector('[data-zoom=in]').click()")
    check("return document.querySelector('.plot-zoom output').textContent==='63%'", "Zoom in control")
    script("document.querySelector('[data-zoom=width]').click()")
    time.sleep(.15)
    check("return [...document.querySelectorAll('.chart-scroll')].every(node=>node.scrollWidth<=node.clientWidth+2)", "Fit width removes horizontal overflow")
    script("document.querySelector('[data-zoom=all]').click()")
    time.sleep(.15)
    check("return [...document.querySelectorAll('.chart-scroll')].every(node=>node.scrollWidth<=node.clientWidth+2&&node.scrollHeight<=node.clientHeight+2)", "Fit all shows the full grid")
    script("document.querySelector('[data-zoom=reset]').click();const card=document.querySelector('.chart-card');window.railBounds={x:card.querySelector('.fixed-x-axis').getBoundingClientRect().top,y:card.querySelector('.fixed-y-axis').getBoundingClientRect().left};const node=card.querySelector('.chart-scroll');node.scrollLeft=400;node.scrollTop=800;")
    time.sleep(.2)
    check("const cards=[...document.querySelectorAll('.chart-card')];return cards.every(card=>Number(card.querySelector('.fixed-x-axis svg').dataset.offset)===card.querySelector('.chart-scroll').scrollLeft&&Number(card.querySelector('.fixed-y-axis svg').dataset.offset)===card.querySelector('.chart-scroll').scrollTop)&&Math.abs(cards[0].querySelector('.fixed-x-axis').getBoundingClientRect().top-window.railBounds.x)<1&&Math.abs(cards[0].querySelector('.fixed-y-axis').getBoundingClientRect().left-window.railBounds.y)<1", "Panning updates tick labels without moving the external rails")
    check("return [...document.querySelectorAll('.fixed-x-axis,.fixed-y-axis')].every(node=>node.querySelectorAll('[data-tick]').length>0)", "Visible parameter ticks remain available after panning")
    script("document.querySelector('.chart-scroll').dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:-100,bubbles:true,cancelable:true}));")
    check("return parseInt(document.querySelector('.plot-zoom output').textContent)>100", "Ctrl-wheel zoom")
    script("document.querySelector('[data-zoom=reset]').click()")
    check("document.getElementById('swap').click(); return ParameterExplorer.state.x === 'bac' && ParameterExplorer.view.selected.length === 279", "Axis swap")
    check("document.querySelector('[data-preset=\"atpm,epsilon\"]').click();return ParameterExplorer.state.y==='epsilon' && ParameterExplorer.view.yvalues.every(value=>JSON.parse(value).length===2)", "Recorded epsilon pairs as a single axis")
    check("return document.querySelector('.fixed-y-axis').getBoundingClientRect().width>=200&&document.querySelector('.fixed-y-axis [data-tick]')!==null", "Paired epsilon labels have a wider fixed Y rail")
    check("document.getElementById('swap').click();return document.querySelector('.fixed-x-axis [data-tick] text').querySelectorAll('tspan').length===2", "Paired epsilon labels use two readable X lines")
    script("document.getElementById('swap').click()")
    check("document.getElementById('shape-tile').click(); return document.querySelector('.plot-point rect') !== null", "Tile marks")
    check("return !document.getElementById('fixed-panel').hidden && document.querySelectorAll('[data-pin]').length === 4 && getComputedStyle(document.getElementById('fixed-panel')).position==='static'", "Four biological conditions always visible")
    check("document.querySelector('.plot-point').dispatchEvent(new MouseEvent('click',{bubbles:true})); return !document.getElementById('inspector').hidden", "Raw point inspector")
    check("return ParameterExplorer.exportFigure().svg.includes('Latent reactions fitted') && ParameterExplorer.exportFigure().svg.includes('One mark per original run')", "Four-panel individual-run vector export")
    request("POST", prefix + "/refresh", {})
    check("return ParameterExplorer.state.y === 'epsilon' && ParameterExplorer.state.shape === 'tile'", "Saved URL view reload")
    check("document.getElementById('reset').click();const select=document.querySelector('[data-pin=\"epsilon\"]');const pair=ParameterExplorer.core.parameter(ParameterExplorer.data.runs.find(run=>run.params.epsilon0===0.01&&run.params.k===0.1),'epsilon');select.value=ParameterExplorer.core.key(pair);select.dispatchEvent(new Event('change'));return ParameterExplorer.view.selected.length>0 && ParameterExplorer.view.selected.every(run=>run.params.epsilon0===0.01&&run.params.k===0.1)", "One paired epsilon selector filters both values exactly")
    check("return !document.querySelector('[data-pin=\"seed\"]')&&!document.querySelector('[data-pin=\"threads\"]')&&!document.querySelector('[data-pin=\"workflow\"]')", "No technical metadata filters")
    check("document.getElementById('show-all').click();return ParameterExplorer.view.selected.length===279", "Show-all button removes all fixed-condition restrictions")
    check("document.querySelector('[data-metric=\"runtime\"] [data-status=\"failed\"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));return !document.getElementById('inspector').hidden&&document.getElementById('point-table').textContent.includes('failed')", "Failed-run inspector")
    check("return document.querySelector('a[download]').getAttribute('href') === 'all_runs_parameters_results.xlsx'", "Complete Excel download link")
    script("document.getElementById('reset').click(); document.getElementById('export-svg').click(); document.getElementById('export-png').click();document.getElementById('export-csv').click();")
    check("return Array.from(document.querySelectorAll('.metric-svg')).every(node => node.getBoundingClientRect().width>0)", "Four visible SVG charts")
    check("const scrollers=Array.from(document.querySelectorAll('.chart-scroll'));return scrollers.every(node=>node.scrollTop===scrollers[0].scrollTop&&node.scrollLeft===scrollers[0].scrollLeft)", "Four charts initially aligned at populated coordinates")
    script("window.scrollTo(0,0)")
    screenshot = request("GET", prefix + "/screenshot")
    (SITE / "preview.png").write_bytes(base64.b64decode(screenshot))
    script("window.scrollTo(0,document.getElementById('charts').offsetTop-30)")
    (SITE / "preview_plots.png").write_bytes(base64.b64decode(request("GET", prefix + "/screenshot")))
    script("window.scrollTo(0,0)")
    request("POST", prefix + "/window/rect", {"width": 430, "height": 900})
    check("return document.documentElement.scrollWidth <= innerWidth && getComputedStyle(document.getElementById('charts')).gridTemplateColumns.split(' ').length === 1", "Mobile layout without page overflow")
    (SITE / "preview_mobile.png").write_bytes(base64.b64decode(request("GET", prefix + "/screenshot")))
    print("Browser QA passed; screenshots saved.")
finally:
    request("DELETE", prefix)
