from __future__ import annotations

import os
import re


def forbidden_keywords_check(answer: str, forbidden: list[str]) -> dict:
    answer_lower = answer.lower()
    hits = [kw for kw in forbidden if kw.lower() in answer_lower]
    return {"passed": not hits, "hits": hits}


def normalize_source(s: str) -> str:
    """Reduce a source to a comparable stem.

    Corpus files are named `section__subsection__name.ext` while goldens cite the
    short `name.ext`, and plurals differ (deployments.html vs deployment.txt), so
    compare the last `__` segment without extension or a trailing "s". Web results
    (URLs) all map to "tavily_web", SQL rows to "query_results".
    """
    s = s.strip().lower()
    if s.startswith(("http://", "https://")):
        return "tavily_web"
    if s in ("database query", "query_results"):
        return "query_results"
    stem = os.path.splitext(os.path.basename(s))[0]
    stem = stem.split("__")[-1]
    return re.sub(r"s$", "", stem)


def source_overlap(actual: list[str], golden: list[str]) -> dict:
    actual_set = {normalize_source(s) for s in actual}
    golden_set = {normalize_source(s) for s in golden}
    overlap = actual_set & golden_set

    return {
        "overlap_pct": round(len(overlap) / max(len(golden_set), 1), 3),
        "matched": sorted(overlap),
        "missed": sorted(golden_set - actual_set),
    }
