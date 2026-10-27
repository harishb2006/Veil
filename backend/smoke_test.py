"""End-to-end smoke test against a running Airlock backend.

Usage (from repo root, with the backend already running):
    python -m backend.smoke_test                       # http://localhost:8000
    python -m backend.smoke_test http://192.168.1.20:8000
    python -m backend.smoke_test --no-cloud            # skip /ask (no cloud key configured)

Scans every demo sample and asks the cloud about each one (plus a leak-test
follow-up on the first), checking that no detected value reached the cloud and
that redacted values never come back.
"""

import argparse
import json
import sys
import time
from pathlib import Path

import httpx

SAMPLES_PATH = Path(__file__).resolve().parent.parent / "samples" / "demo_samples.json"


def _check(condition: bool, message: str, failures: list[str]) -> None:
    print(f"  [{'ok' if condition else 'FAIL'}] {message}")
    if not condition:
        failures.append(message)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("base_url", nargs="?", default="http://localhost:8000")
    parser.add_argument("--no-cloud", action="store_true", help="skip the /ask checks")
    args = parser.parse_args()

    client = httpx.Client(base_url=args.base_url.rstrip("/"), timeout=180)
    failures: list[str] = []

    try:
        health = client.get("/health").json()
    except httpx.HTTPError as error:
        print(f"Cannot reach the backend at {args.base_url}: {error}")
        return 1
    while health.get("gemma_status") == "loading":
        print("Gemma is still loading, waiting...")
        time.sleep(5)
        health = client.get("/health").json()
    print(f"/health -> {health}")
    if not health.get("gemma_loaded"):
        print("  note: Gemma is not loaded, so this run is rules-only.")

    samples = json.loads(SAMPLES_PATH.read_text(encoding="utf-8"))
    scans = []
    for sample in samples:
        print(f"\n/scan [{sample['id']}]")
        response = client.post("/scan", json={"text": sample["text"]})
        _check(response.status_code == 200, f"HTTP {response.status_code}", failures)
        if response.status_code != 200:
            continue
        body = response.json()
        scans.append((sample, body))
        print(f"  risk={body['risk']} gemma_used={body['gemma_used']} timings_ms={body['timings_ms']}")
        for entity in body["entities"]:
            print(f"    {entity['source']:5} {entity['type']:12} {entity['replacement']:16} {entity['text']}")
        leaked = [e["text"] for e in body["entities"] if e["text"] in body["sanitized_text"]]
        _check(not leaked, f"sanitized_text hides every detected value {leaked or ''}", failures)

    if args.no_cloud:
        print("\nSkipping /ask (--no-cloud).")
    elif not health.get("cloud_configured"):
        print("\nSkipping /ask: cloud is not configured (set CLOUD_API_KEY and CLOUD_MODEL in .env).")
    else:
        turns = [(sample, scan, "first turn", {"scan_id": scan["scan_id"]}) for sample, scan in scans]
        if scans:
            sample, scan = scans[0]
            turns.insert(1, (sample, scan, "follow-up", {"scan_id": scan["scan_id"], "question": "What was the API key exactly?"}))
        for sample, scan, label, payload in turns:
            detected = [e["text"] for e in scan["entities"]]
            redacted = [e for e in scan["entities"] if e["redacted"]]
            print(f"\n/ask [{sample['id']}] {label}")
            response = client.post("/ask", json=payload)
            _check(response.status_code == 200, f"HTTP {response.status_code} {response.text[:200] if response.status_code != 200 else ''}", failures)
            if response.status_code != 200:
                continue
            body = response.json()
            print(f"  cloud_model={body['cloud_model']} timings_ms={body['timings_ms']}")
            print(f"  cloud saw : {body['cloud_saw']}")
            print(f"  you see   : {body['response']}")
            leaked = [value for value in detected if value in body["cloud_saw"]]
            _check(not leaked, f"cloud_saw contains no detected value {leaked or ''}", failures)
            restored = [e["text"] for e in redacted if e["text"] in body["response"]]
            _check(not restored, f"redacted values are never rehydrated {restored or ''}", failures)

    print("\n/ask unknown scan_id")
    status = client.post("/ask", json={"scan_id": "does-not-exist"}).status_code
    _check(status == 404, f"returns 404 (got {status})", failures)

    print("\n" + ("PASS" if not failures else f"FAIL ({len(failures)} check(s))"))
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
