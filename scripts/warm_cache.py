"""Fill Gemma's answer cache before a demo, so the live run does not wait on the model.

Runs every demo scenario once (raw and full) and scans every sandbox sample page through the outer door, against
a backend that is already running with Gemma loaded. Gemma's answers are saved in .cache/gemma_cache.jsonl, so a
later run of the same scenario reuses them, even after a backend restart. Inputs that change (a page you paste,
a new task) still go to the model.

    .venv\\Scripts\\python.exe scripts\\warm_cache.py
    .venv\\Scripts\\python.exe scripts\\warm_cache.py --api http://localhost:8001

Uses only the standard library.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request


def call(api: str, path: str, body: dict | None = None, timeout: float = 900) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(api + path, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def wait_for_runs(api: str, run_ids: dict, timeout: float) -> dict:
    deadline = time.time() + timeout
    finished: dict = {}
    while len(finished) < len(run_ids) and time.time() < deadline:
        for mode, run_id in run_ids.items():
            if mode not in finished:
                run = call(api, f"/agent/runs/{run_id}")
                if run["status"] != "running":
                    finished[mode] = run
        time.sleep(2)
    return finished


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--api", default="http://localhost:8000")
    parser.add_argument("--run-timeout", type=float, default=900, help="seconds to wait for each scenario")
    args = parser.parse_args()
    api = args.api.rstrip("/")

    try:
        health = call(api, "/health", timeout=10)
    except (urllib.error.URLError, OSError) as error:
        print(f"Cannot reach VEIL at {api}: {error}. Start the backend first.")
        return 1
    if health.get("gemma_status") != "loaded":
        print(f"Gemma is '{health.get('gemma_status')}', not loaded; there is nothing to cache. Wait for it to load and retry.")
        return 1

    samples = call(api, "/sandbox/samples")
    total_started = time.perf_counter()

    print("Scenarios (raw and full):")
    for scenario in samples["scenarios"]:
        call(api, "/sandbox/reset", {})
        started = time.perf_counter()
        runs = wait_for_runs(api, call(api, "/agent/compare", {"task": scenario["task"]})["run_ids"], args.run_timeout)
        summary = runs.get("full", {}).get("summary", {})
        print(f"  {scenario['title']:<30} {time.perf_counter() - started:6.1f} s   full: {summary.get('findings', '?')} finding(s), {summary.get('blocked', '?')} blocked")
    call(api, "/sandbox/reset", {})

    print("Sample pages through the outer door:")
    for page in samples.get("pages", []):
        url = page.get("url")
        if not url:
            continue
        html = call(api, f"/sandbox/page?url={urllib.request.quote(url, safe=':/')}")["html"]
        started = time.perf_counter()
        result = call(api, "/firewall/scan", {"content": html, "content_type": "html", "tool": "fetch_page"})
        print(f"  {page.get('title', url)[:30]:<30} {time.perf_counter() - started:6.1f} s   {result['verdict']}")

    print(f"Done in {time.perf_counter() - total_started:.0f} s. Run it again to see the cached timings.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
