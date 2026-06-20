#!/usr/bin/env python3
"""Export Chinese hint dictionary TSV from chinese-dictionary.sqlite."""

from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path


SAMPLE_LIMIT = 5


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export dict(chn, pos, pyn, jpn, rad) rows to headword/body TSV.",
    )
    parser.add_argument("--dict", required=True, dest="dict_path", help="Path to chinese-dictionary.sqlite")
    parser.add_argument("--out", required=True, dest="out_path", help="Output TSV path")
    return parser.parse_args()


def clean_cell(value: object) -> str:
    text = "" if value is None else str(value)
    return " ".join(text.replace("\t", " ").splitlines()).strip()


def create_body(pos: object, pyn: object, jpn: object, rad: object) -> str:
    # Keep each TSV record on one physical line so the extension's line-based
    # importer can consume it. Hint UI renders the escaped line breaks as text.
    fields = [
        ("pos", clean_cell(pos)),
        ("pyn", clean_cell(pyn)),
        ("jpn", clean_cell(jpn)),
        ("rad", clean_cell(rad)),
    ]
    return "\\n".join(f"{label}: {value}" for label, value in fields if value)


def main() -> int:
    args = parse_args()
    dict_path = Path(args.dict_path)
    out_path = Path(args.out_path)

    print(f"[export] dictionary: {dict_path}")
    print(f"[export] output: {out_path}")

    if not dict_path.exists():
        raise FileNotFoundError(f"Dictionary file not found: {dict_path}")

    out_path.parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(dict_path)
    try:
        total_rows = connection.execute("select count(*) from dict").fetchone()[0]
        print(f"[export] sqlite rows: {total_rows}")

        skipped = 0
        exported = 0
        samples: list[str] = []

        with out_path.open("w", encoding="utf-8", newline="\n") as output:
            rows = connection.execute("select chn, pos, pyn, jpn, rad from dict order by chn")
            for chn, pos, pyn, jpn, rad in rows:
                headword = clean_cell(chn)
                body = create_body(pos, pyn, jpn, rad)

                if not headword or not body:
                    skipped += 1
                    continue

                line = f"{headword}\t{body}"
                output.write(line + "\n")
                exported += 1

                if len(samples) < SAMPLE_LIMIT:
                    samples.append(line[:240])

        print(f"[export] exported rows: {exported}")
        print(f"[export] skipped rows: {skipped}")
        print("[export] samples:")
        for index, sample in enumerate(samples, start=1):
            print(f"  {index}. {sample}")
    finally:
        connection.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
