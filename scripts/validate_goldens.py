"""Check eval/seed_questions.yaml: schema, unique ids, and that every cited
document actually exists in the corpus (the original goldens cited 7 files that
were never shipped)."""

from __future__ import annotations

import sys
from pathlib import Path

from eval.post_checks import normalize_source
from eval.schema import load_goldens

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "seed" / "docs"


def main() -> int:
    goldens = load_goldens(ROOT / "eval" / "seed_questions.yaml")
    corpus = {normalize_source(p.name) for p in DOCS.rglob("*") if p.is_file() and p.name != ".gitkeep"}
    virtual = {"tavily_web", "query_results"}
    missing: dict[str, list[str]] = {}
    for g in goldens:
        for src in g.golden_sources:
            stem = normalize_source(src)
            if stem in virtual or "." not in src:
                continue
            if stem not in corpus:
                missing.setdefault(src, []).append(g.id)
    print(f"{len(goldens)} goldens loaded; {len(corpus)} corpus documents")
    if missing:
        print("Cited documents missing from seed/docs:")
        for src, ids in sorted(missing.items()):
            print(f"  {src}: {', '.join(ids)}")
        return 1
    print("Every cited document exists in the corpus.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
