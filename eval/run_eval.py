"""Measure detection recall and scan latency against a running Airlock backend.

Usage (from repo root, backend already running):
    python eval/run_eval.py                         # http://localhost:8000
    python eval/run_eval.py http://192.168.1.20:8000 --json results.json

For every prompt in eval/dataset.jsonl it calls /scan and checks whether each
expected value was caught (an entity whose text contains, or is contained in,
the expected value). Recall is reported overall, per tier (rule vs Gemma) and
per type, with /scan timings. Run once with GEMMA_ENABLED=false and once with
Gemma on to get the rules-only vs rules+Gemma comparison for the README.
Only report numbers this script actually printed.
"""

import argparse
import json
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path

import httpx

DATASET = Path(__file__).resolve().parent / "dataset.jsonl"


def _caught(expected: str, entities: list[dict]) -> dict | None:
    for entity in entities:
        if expected in entity["text"] or entity["text"] in expected:
            return entity
    return None


def _wait_until_ready(client: httpx.Client, timeout_s: float = 180) -> dict:
    deadline = time.time() + timeout_s
    while True:
        health = client.get("/health").json()
        if health.get("gemma_status") != "loading" or time.time() > deadline:
            return health
        print("  Gemma is still loading, waiting...")
        time.sleep(5)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("base_url", nargs="?", default="http://localhost:8000")
    parser.add_argument("--json", type=Path, help="also write the per-prompt results to this file")
    args = parser.parse_args()

    client = httpx.Client(base_url=args.base_url.rstrip("/"), timeout=300)
    try:
        health = _wait_until_ready(client)
    except httpx.HTTPError as error:
        print(f"Cannot reach the backend at {args.base_url}: {error}")
        return 1
    mode = "rules + Gemma" if health.get("gemma_loaded") else "rules only"
    print(f"Backend {args.base_url} | mode: {mode} | model: {health.get('model_alias')}\n")

    records = [json.loads(line) for line in DATASET.read_text(encoding="utf-8").splitlines() if line.strip()]
    total = caught = 0
    by_type: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    by_source: dict[str, int] = defaultdict(int)
    gemma_ms: list[int] = []
    total_ms: list[int] = []
    gemma_used_count = 0
    rows = []

    for record in records:
        response = client.post("/scan", json={"text": record["text"]})
        if response.status_code != 200:
            print(f"{record['id']}: HTTP {response.status_code} {response.text[:200]}")
            return 1
        body = response.json()
        gemma_used_count += bool(body["gemma_used"])
        if body["gemma_used"]:
            gemma_ms.append(body["timings_ms"]["gemma"])
        total_ms.append(body["timings_ms"]["total"])

        misses = []
        for expected in record["expected"]:
            total += 1
            by_type[expected["type"]][1] += 1
            hit = _caught(expected["text"], body["entities"])
            if hit:
                caught += 1
                by_type[expected["type"]][0] += 1
                by_source[hit["source"]] += 1
            else:
                misses.append(expected["text"])
        rows.append({"id": record["id"], "misses": misses, "timings_ms": body["timings_ms"], "gemma_used": body["gemma_used"]})
        status = "ok  " if not misses else "MISS"
        print(f"  {status} {record['id']}  total={body['timings_ms']['total']:>6} ms  {('missed: ' + ', '.join(misses)) if misses else ''}")

    print(f"\nRecall ({mode}): {caught}/{total} = {caught / total:.0%}")
    print(f"  caught by rules: {by_source['rule']}   caught by Gemma: {by_source['gemma']}")
    print("\n  type           caught")
    for entity_type in sorted(by_type):
        hit, count = by_type[entity_type]
        print(f"  {entity_type:<14} {hit}/{count}")

    print(f"\n/scan latency over {len(records)} prompts: median {statistics.median(total_ms)} ms, max {max(total_ms)} ms")
    if gemma_ms:
        print(f"Gemma text-only latency over {len(gemma_ms)} prompts: median {statistics.median(gemma_ms)} ms, "
              f"min {min(gemma_ms)} ms, max {max(gemma_ms)} ms")
    if health.get("gemma_loaded") and gemma_used_count < len(records):
        print(f"WARNING: Gemma failed on {len(records) - gemma_used_count} prompt(s); see backend logs.")

    if args.json:
        args.json.write_text(json.dumps({"mode": mode, "recall": caught / total, "prompts": rows}, indent=2), encoding="utf-8")
        print(f"\nWrote {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
