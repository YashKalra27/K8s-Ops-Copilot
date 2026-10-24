"""Compare two eval result files (e.g. naive vs all) metric by metric.

    uv run python -m eval.diff eval/results/<ts>_naive.json eval/results/<ts>_all.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from eval.reporting import METRIC_KEYS


def _load(path: str) -> dict:
    return json.loads(Path(path).read_text())


def _fmt(v: float | None) -> str:
    return "  -  " if v is None else f"{v:.3f}"


def main(base_path: str, new_path: str) -> None:
    base, new = _load(base_path), _load(new_path)
    print(f"\n## {base['profile']}  ->  {new['profile']}\n")
    print("| metric | base | new | delta |")
    print("|---|---|---|---|")
    for key in METRIC_KEYS + ["forbidden_violations"]:
        b, n = base["aggregate"].get(key), new["aggregate"].get(key)
        delta = "" if b is None or n is None else f"{n - b:+.3f}"
        print(f"| {key} | {_fmt(b)} | {_fmt(n)} | {delta} |")

    base_rows = {r["id"]: r for r in base["rows"]}
    print("\n| id | feature | faithfulness base -> new | context_recall base -> new |")
    print("|---|---|---|---|")
    for row in new["rows"]:
        old = base_rows.get(row["id"])
        if not old:
            continue
        bm, nm = old.get("ragas_metrics") or {}, row.get("ragas_metrics") or {}
        print(
            f"| {row['id']} | {row['demonstrates_feature']} | "
            f"{_fmt(bm.get('faithfulness'))} -> {_fmt(nm.get('faithfulness'))} | "
            f"{_fmt(bm.get('context_recall'))} -> {_fmt(nm.get('context_recall'))} |"
        )


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: python -m eval.diff <base.json> <new.json>")
    main(sys.argv[1], sys.argv[2])
