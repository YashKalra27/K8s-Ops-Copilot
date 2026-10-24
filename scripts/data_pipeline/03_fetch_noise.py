"""Download the *noise* half of the knowledge base: random, unrelated PDFs from
github.com/tpn/pdfs (a public collection of technical papers and books).

The project's design is ~95% noise / ~5% signal, so that naive retrieval
visibly fails and each advanced technique has to earn its place. The full
design uses ~950 files; that takes hours to embed on a laptop, so the default
here is a smaller seeded sample. Selection is deterministic (seeded), and only
small PDFs are taken to keep disk use and parsing time down.

    uv run python scripts/data_pipeline/03_fetch_noise.py --count 60
    uv run python scripts/data_pipeline/03_fetch_noise.py --count 950   # full design
"""

from __future__ import annotations

import argparse
import json
import random
import urllib.parse
import urllib.request
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parents[2] / "seed" / "docs" / "noisy_data"
TREE_URL = "https://api.github.com/repos/tpn/pdfs/git/trees/master?recursive=0"
RAW_URL = "https://raw.githubusercontent.com/tpn/pdfs/master/"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--count", type=int, default=60)
    ap.add_argument("--max-mb", type=float, default=1.5, help="skip PDFs larger than this")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(TREE_URL, timeout=30) as resp:  # noqa: S310
        tree = json.load(resp)["tree"]
    candidates = sorted(
        (e for e in tree if e["path"].lower().endswith(".pdf") and e.get("size", 0) < args.max_mb * 1e6),
        key=lambda e: e["path"],
    )
    picks = random.Random(args.seed).sample(candidates, min(args.count, len(candidates)))

    have = {p.name for p in OUT_DIR.glob("*.pdf")}
    downloaded = 0
    for entry in picks:
        name = "noise__" + "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in entry["path"])
        if name in have:
            continue
        url = RAW_URL + urllib.parse.quote(entry["path"])
        try:
            with urllib.request.urlopen(url, timeout=60) as resp:  # noqa: S310
                (OUT_DIR / name).write_bytes(resp.read())
            downloaded += 1
            print(f"[{downloaded}] {name}")
        except Exception as exc:  # noqa: BLE001
            print(f"skip {entry['path']}: {exc}")
    total = len(list(OUT_DIR.glob("*.pdf")))
    print(f"done: {downloaded} new, {total} noise PDFs in {OUT_DIR}")


if __name__ == "__main__":
    main()
