"""Validate that every labelled entity occurs exactly as written in its prompt."""

import json
from pathlib import Path


def main() -> None:
    path = Path(__file__).with_name("dataset.jsonl")
    lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line]
    if len(lines) != 25:
        raise ValueError(f"expected 25 lines, found {len(lines)}")

    for number, line in enumerate(lines, start=1):
        record = json.loads(line)
        text = record["text"]
        for entity in record["expected"]:
            if entity["text"] not in text:
                raise ValueError(
                    f"line {number}: {entity['text']!r} is not a substring of text"
                )
    print("OK 25 lines")


if __name__ == "__main__":
    main()
