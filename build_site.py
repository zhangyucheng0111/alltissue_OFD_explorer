#!/usr/bin/env python3
"""Package the recorded parameter attempts as a self-contained offline page."""

import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import re
from datetime import datetime, timezone


SITE_DIR = Path(__file__).resolve().parent
DEFAULT_SOURCE = SITE_DIR / "all_attempts.tsv"
if not DEFAULT_SOURCE.exists():
    DEFAULT_SOURCE = SITE_DIR.parent / "flexibility_atlas_20261022_1845" / "all_279_attempts.tsv"
FINAL_PROTOCOLS = {
    "robustOFD_20261022_integerLock",
    "robustOFD_20261022_validation",
}
FINAL_POLICY = "Integer-lock fix; total-flux gap 1e-4"
FRONTEND_FILES = ("template.html", "styles.css", "plot_core.js", "app.js")
MISSING = {"", "na", "n/a", "nan", "none", "null", "<na>", "nat", "[]"}
SCALE = 2 / 5.5
EPSILON_FILES = {
    "epsilon_e001_k01.mat": (0.01, 0.1),
    "epsilon_e001_k05.mat": (0.01, 0.5),
    "epsilon_e0005_k01.mat": (0.005, 0.1),
    "epsilon_e0005_k05.mat": (0.005, 0.5),
    "epsilon_e0001_k01.mat": (0.001, 0.1),
    "epsilon_e0001_k05.mat": (0.001, 0.5),
    "epsilon_e0009_k01.mat": (0.009, 0.1),
    "epsilon_e0011_k01.mat": (0.011, 0.1),
    "epsilon_e001_k009.mat": (0.01, 0.09),
    "epsilon_e001_k011.mat": (0.01, 0.11),
    "epsilon_scale_2of5p5.mat": (0.01 * SCALE, 0.1 * SCALE),
    "epsilon_scale_e095.mat": (0.01 * SCALE * 0.95, 0.1 * SCALE),
    "epsilon_scale_e105.mat": (0.01 * SCALE * 1.05, 0.1 * SCALE),
    "epsilon_scale_k095.mat": (0.01 * SCALE, 0.1 * SCALE * 0.95),
    "epsilon_scale_k105.mat": (0.01 * SCALE, 0.1 * SCALE * 1.05),
}
EPSILON_NOTE = (
    "Effective epsilon0 and k are mapped explicitly from the epsilon filename, "
    "overriding nominal TSV values for known files. epsilon_scale_2of5p5.mat "
    "uses original (0.01, 0.1) times 2/5.5; e095/e105 change only scaled "
    "epsilon0 by 0.95/1.05 and k095/k105 change only scaled k. Standard "
    "epsilon_e001_k01.mat means (0.01, 0.1), e0009 means epsilon0=0.009. "
    "Unknown filenames use finite explicit TSV epsilon0/k values or null; "
    "no epsilon MAT files are loaded and no model is run."
)


def clean_text(value):
    if value is None:
        return None
    value = str(value).strip()
    return None if value.lower() in MISSING else value


def number(value):
    value = clean_text(value)
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return parsed if math.isfinite(parsed) else None


def first_number(row, *keys):
    for key in keys:
        parsed = number(row.get(key))
        if parsed is not None:
            return parsed
    return None


def boolean(value):
    value = clean_text(value)
    if value is None:
        return None
    if value.lower() in {"true", "yes", "on", "pass", "passed"}:
        return True
    if value.lower() in {"false", "no", "off", "fail", "failed"}:
        return False
    parsed = number(value)
    return bool(parsed) if parsed is not None else None


def required_switch(row, key):
    parsed = boolean(row.get(key))
    if parsed is None:
        raise ValueError(f"Missing or invalid {key} in {row.get('run_id')}")
    return parsed


def coefficient(row, switch, effective, nominal):
    if boolean(row.get(switch)) is False:
        return "off"
    return first_number(row, effective, nominal)


def effective_epsilon(row):
    filename = clean_text(row.get("epsilon"))
    if filename is not None and Path(filename).name in EPSILON_FILES:
        return EPSILON_FILES[Path(filename).name]
    return number(row.get("epsilon0")), number(row.get("k"))


def positive_evidence(value):
    parsed = boolean(value)
    if parsed is not None:
        return parsed
    value = clean_text(value)
    return value is not None and value.lower() not in {"{}", "no evidence", "no warnings"}


def has_time_limit(row):
    for key, value in row.items():
        key = key.lower()
        text = clean_text(value)
        if text is None:
            continue
        if "time_limit" in key and positive_evidence(value):
            return True
        if re.search(r"\bTIME[ _-]+LIMIT(?:ED)?\b", text, re.IGNORECASE):
            return True
    return False


def has_warning(row):
    for key, value in row.items():
        key = key.lower()
        if ("warning" in key or key == "numerical_retry") and positive_evidence(value):
            return True
        text = clean_text(value)
        if text and re.search(r"\b(?:numerical[ _-]+warning|warning:)\b", text, re.IGNORECASE):
            return True
    return False


def normalize_run(row, source):
    run_id = clean_text(row.get("run_id"))
    protocol = clean_text(row.get("protocol"))
    case = clean_text(row.get("case"))
    if not all((run_id, protocol, case)):
        raise ValueError("Every attempt must have a run_id, protocol and case")
    epsilon0, epsilon_k = effective_epsilon(row)
    workflow = "OFD" if required_switch(row, "doLatent") else "PFD only"
    scope = "final" if protocol in FINAL_PROTOCOLS else protocol
    return {
        "id": run_id,
        "case": case,
        "protocol": protocol,
        "scope": scope,
        "params": {
            "atpm": number(row.get("ATPm")),
            "bac": coefficient(row, "doMinBac", "effective_bacCoef", "bacCoef"),
            "exchange": coefficient(row, "doMinExc", "effective_excCoef", "excCoef"),
            "epsilon0": epsilon0,
            "k": epsilon_k,
            "warm": "On" if required_switch(row, "doWarmStart") else "Off",
            "hard": "On" if required_switch(row, "hardConstrainLow") else "Off",
            "seed": number(row.get("seed")),
            "threads": first_number(row, "actual_threads", "threads"),
            "workflow": workflow,
            "policy": FINAL_POLICY if scope == "final" else clean_text(row.get("policy")) or "Historical original",
        },
        "metrics": {
            "runtime": number(row.get("fit_min")),
            "waste": number(row.get("wastePercent")),
            "ratio": number(row.get("ATPmRatio")),
            "latent": number(row.get("latentFit")),
        },
        "meta": {
            "state": clean_text(row.get("state")),
            "timeLimit": has_time_limit(row),
            "warning": has_warning(row),
            "validation": boolean(row.get("validation_passed")),
            "jointPass": boolean(row.get("joint_pass")),
            "elapsedSeconds": first_number(row, "elapsed_s", "failed_elapsed_s", "fit_elapsed"),
            "workflowSeconds": number(row.get("workflow_elapsed_s")),
            "uptake": number(row.get("uptake")),
            "totalATPm": number(row.get("totalATPm")),
            "Nfit": first_number(row, "NfitScore", "highFit_reported_Nfit"),
            "minLow": number(row.get("minLow")),
            "minTotal": number(row.get("minTotal")),
            "exchangeFlux": number(row.get("OFD_exchange" if workflow == "OFD" else "PFD_exchange")),
            "epsilonFile": clean_text(row.get("epsilon")),
            "failureStage": clean_text(row.get("failure_stage")),
            "error": clean_text(row.get("error")),
            "started": clean_text(row.get("started")),
            "source": clean_text(row.get("source")) or str(source),
        },
    }


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def build_payload(source=DEFAULT_SOURCE):
    """Read and validate data without writing outputs or requiring frontend files."""
    source = Path(source).resolve()
    with source.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        required = {"run_id", "protocol", "case", "state", "epsilon"}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError(f"TSV is missing required columns: {sorted(required - set(reader.fieldnames or []))}")
        rows = list(reader)
    provenance_file = SITE_DIR / 'historical_provenance.json'
    provenance = json.loads(provenance_file.read_text()) if provenance_file.exists() else {}
    runs = [normalize_run(row, source) for row in rows]
    for row, run in zip(rows, runs):
        if not clean_text(row.get('source')) and run['id'] in provenance:
            run['meta']['source'] = provenance[run['id']]
    ids = [run["id"] for run in runs]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate run IDs; attempts must not be silently combined")
    if len(runs) < 279:
        raise ValueError(f"Expected at least the 279 historical attempts, found {len(runs)}")
    counts = {}
    for run in runs:
        counts[run["scope"]] = counts.get(run["scope"], 0) + 1
    if counts.get("final") != 19:
        raise ValueError(f"Expected 19 final attempts, found {counts.get('final', 0)}")
    scopes = []
    for scope in sorted(counts, key=lambda scope: (scope != "final", scope)):
        scopes.append({
            "id": scope,
            "label": "Final protocol" if scope == "final" else scope,
            "description": (
                "robustOFD_20261022_integerLock + robustOFD_20261022_validation; " + FINAL_POLICY
                if scope == "final" else "Recorded attempts from this protocol only; compare within this scope."
            ),
            "count": counts[scope],
        })
    payload = {
        "meta": {
            "title": "Young AllTissue parameter explorer",
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "sourceCount": len(runs),
            "sources": [{"path": str(source), "sha256": sha256(source), "rows": len(runs)}],
            "epsilonProvenance": EPSILON_NOTE,
            "epsilonMapping": {name: {"epsilon0": pair[0], "k": pair[1]} for name, pair in EPSILON_FILES.items()},
        },
        "scopes": scopes,
        "runs": runs,
    }
    status_file = SITE_DIR / 'scan_status.json'
    if status_file.exists():
        payload['meta']['scanSummary'] = json.loads(status_file.read_text())
    json.dumps(payload, allow_nan=False)
    return payload


def script_safe_json(payload):
    serialized = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    for character, escaped in (("&", "\\u0026"), ("<", "\\u003c"), (">", "\\u003e"), ("\u2028", "\\u2028"), ("\u2029", "\\u2029")):
        serialized = serialized.replace(character, escaped)
    return serialized


def build_site(source=DEFAULT_SOURCE):
    missing = [name for name in FRONTEND_FILES if not (SITE_DIR / name).is_file()]
    if missing:
        raise ValueError("Frontend files are not ready; no outputs written. Missing: " + ", ".join(missing))
    payload = build_payload(source)
    frontend = {name: (SITE_DIR / name).read_text(encoding="utf-8") for name in FRONTEND_FILES}
    replacements = {
        "__STYLE__": frontend["styles.css"],
        "__DATA__": script_safe_json(payload),
        "__CORE__": frontend["plot_core.js"],
        "__APP__": frontend["app.js"],
    }
    template = frontend["template.html"]
    for token in replacements:
        if template.count(token) != 1:
            raise ValueError(f"template.html must contain {token} exactly once")
    html = re.sub(r"__STYLE__|__DATA__|__CORE__|__APP__", lambda match: replacements[match.group()], template)
    output_texts = {
        "data.json": json.dumps(payload, ensure_ascii=False, allow_nan=False, indent=2) + "\n",
        "index.html": html,
    }
    inputs = [Path(source).resolve(), Path(__file__).resolve(), SITE_DIR / "README.md"]
    inputs.extend(path for path in [SITE_DIR / 'historical_provenance.json', SITE_DIR / 'scan_status.json'] if path.exists())
    inputs.extend(SITE_DIR / name for name in FRONTEND_FILES)
    manifest = {
        "title": payload["meta"]["title"],
        "generatedAt": payload["meta"]["generatedAt"],
        "sourceCount": len(payload["runs"]),
        "scopeCounts": {scope["id"]: scope["count"] for scope in payload["scopes"]},
        "epsilonProvenance": EPSILON_NOTE,
        "inputs": [{"path": str(path), "sha256": sha256(path)} for path in inputs],
        "outputs": {name: {"sha256": hashlib.sha256(content.encode("utf-8")).hexdigest()} for name, content in output_texts.items()},
    }
    output_texts["manifest.json"] = json.dumps(manifest, ensure_ascii=False, allow_nan=False, indent=2) + "\n"
    for name, content in output_texts.items():
        temporary = SITE_DIR / (name + '.tmp')
        temporary.write_text(content, encoding="utf-8")
        temporary.replace(SITE_DIR / name)
    return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="Historical plus supplemental attempts TSV with the same schema")
    args = parser.parse_args()
    try:
        payload = build_site(args.source)
    except (OSError, ValueError, csv.Error) as error:
        parser.exit(1, f"Build failed: {error}\n")
    print(f"Built index.html, data.json and manifest.json: {len(payload['runs'])} unique attempts, 19 final runs.")


if __name__ == "__main__":
    main()
