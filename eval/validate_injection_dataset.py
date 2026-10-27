"""Validate eval/injection_dataset.jsonl: schema, files on disk, unique ids, and counts per label and kind.

    python3 eval/validate_injection_dataset.py
"""

import json
import sys
from collections import Counter
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
SANDBOX = EVAL_DIR.parent / "sandbox"
DATASET = EVAL_DIR / "injection_dataset.jsonl"

ATTACK_KINDS = {"HIDDEN_CSS", "WHITE_TEXT", "TINY_TEXT", "COMMENT", "ATTR", "ZERO_WIDTH", "UNICODE_TAG", "BASE64", "PLAIN_SIGHT", "EXFIL_URL", "SHELL"}
FIELDS = {"id", "label", "kind", "tool", "page", "task", "attacker_goal", "origin"}
ORIGINS = ("hand", "template", "published")  # published = modelled on a public incident; needs a "source" URL
TOOLS = {"fetch_page", "read_email"}
GOAL_TOOLS = {"send_email", "run_shell"}
MIN_HAND = 15


def check(record: dict, number: int) -> list[str]:
    errors = []
    where = f"line {number} ({record.get('id', '?')})"
    expected = FIELDS | ({"source"} if record.get("origin") == "published" else set())
    if set(record) != expected:
        return [f"{where}: fields must be exactly {sorted(expected)}, got {sorted(record)}"]
    if record["origin"] == "published" and not str(record["source"]).startswith("https://"):
        return [f"{where}: published items need a source URL (https://...)"]
    if record["label"] not in ("attack", "clean"):
        errors.append(f"{where}: label must be attack|clean")
    if record["label"] == "attack" and record["kind"] not in ATTACK_KINDS:
        errors.append(f"{where}: attack kind must be one of {sorted(ATTACK_KINDS)}")
    if record["label"] == "clean" and record["kind"] != "CLEAN":
        errors.append(f"{where}: clean items must have kind CLEAN")
    if record["tool"] not in TOOLS:
        errors.append(f"{where}: tool must be one of {sorted(TOOLS)}")
    if record["origin"] not in ORIGINS:
        errors.append(f"{where}: origin must be one of {'|'.join(ORIGINS)}")
    prefix = "a" if record["label"] == "attack" else "c"
    if not str(record["id"]).startswith(prefix):
        errors.append(f"{where}: id should start with {prefix!r}")
    goal = record["attacker_goal"]
    if record["label"] == "clean":
        if goal is not None:
            errors.append(f"{where}: clean items need attacker_goal null")
    elif not (isinstance(goal, dict) and goal.get("tool") in GOAL_TOOLS and goal.get("to_domain")):
        errors.append(f"{where}: attack needs attacker_goal {{tool: send_email|run_shell, to_domain}}")
    page = SANDBOX / str(record["page"])
    if not page.is_file():
        errors.append(f"{where}: page file {record['page']} does not exist")
    else:
        if record["tool"] == "read_email" and not page.name.endswith(".eml.txt"):
            errors.append(f"{where}: read_email items must use a .eml.txt page")
        if record["tool"] == "fetch_page" and page.suffix != ".html":
            errors.append(f"{where}: fetch_page items must use an .html page")
        if page.stem.split(".")[0] != record["id"]:
            errors.append(f"{where}: page file name should start with the item id")
    if f"https://eval.test/{record['id']}" not in record["task"] or "@" not in record["task"]:
        errors.append(f"{where}: task must mention https://eval.test/{record['id']} and a recipient")
    return errors


def main() -> int:
    lines = [line for line in DATASET.read_text(encoding="utf-8").splitlines() if line.strip()]
    records, errors = [], []
    for number, line in enumerate(lines, start=1):
        try:
            record = json.loads(line)
        except ValueError as error:
            errors.append(f"line {number}: invalid JSON ({error})")
            continue
        records.append(record)
        errors.extend(check(record, number))

    ids = Counter(r.get("id") for r in records)
    errors.extend(f"duplicate id {i}" for i, n in ids.items() if n > 1)
    hand = sum(r.get("origin") == "hand" for r in records)
    if hand < MIN_HAND:
        errors.append(f"need at least {MIN_HAND} hand-written items, found {hand}")

    on_disk = {p.name for p in (SANDBOX / "pages" / "eval").glob("*") if p.is_file()}
    listed = {Path(r["page"]).name for r in records if "page" in r}
    for orphan in sorted(on_disk - listed):
        errors.append(f"page file {orphan} is not referenced by the dataset")

    if errors:
        print("INVALID")
        for error in errors:
            print("  -", error)
        return 1

    labels = Counter(r["label"] for r in records)
    published = sum(r.get("origin") == "published" for r in records)
    print(f"OK {len(records)} items: {labels['attack']} attack, {labels['clean']} clean | {hand} hand-written, "
          f"{published} modelled on published incidents, {len(records) - hand - published} template")
    print("\n  label   kind          count")
    for (label, kind), count in sorted(Counter((r["label"], r["kind"]) for r in records).items()):
        print(f"  {label:<7} {kind:<13} {count}")
    print("\n  tool          count")
    for tool, count in sorted(Counter(r["tool"] for r in records).items()):
        print(f"  {tool:<13} {count}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
