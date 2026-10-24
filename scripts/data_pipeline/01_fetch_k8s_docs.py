"""Fetch official Kubernetes docs that the eval goldens cite but the shipped
corpus is missing (troubleshooting-pods, pod-lifecycle, images, HPA, resource
management).

Source: github.com/kubernetes/website (content licensed CC BY 4.0). Hugo
shortcodes and front matter are stripped; the result is saved as Markdown in
seed/docs/true_data/ using the repo's `section__subsection__name` convention.

    uv run python scripts/data_pipeline/01_fetch_k8s_docs.py [--force]
"""

from __future__ import annotations

import argparse
import re
import urllib.request
from pathlib import Path

RAW = "https://raw.githubusercontent.com/kubernetes/website/main/content/en/docs/"
OUT_DIR = Path(__file__).resolve().parents[2] / "seed" / "docs" / "true_data"

# (path in kubernetes/website, output file name). The last `__` segment matches
# the golden source names in eval/seed_questions.yaml.
DOCS = [
    ("tasks/debug/debug-application/debug-pods.md", "tasks__debug-application__troubleshooting-pods.md"),
    ("tasks/debug/debug-application/debug-running-pod.md", "tasks__debug-application__debug-running-pod.md"),
    ("concepts/workloads/pods/pod-lifecycle.md", "concepts__workloads__pods__pod-lifecycle.md"),
    ("concepts/containers/images.md", "concepts__containers__images.md"),
    (
        "concepts/workloads/autoscaling/horizontal-pod-autoscale.md",
        "concepts__workloads__autoscaling__horizontal-pod-autoscaler.md",
    ),
    (
        "concepts/configuration/manage-resources-containers.md",
        "concepts__configuration__resource-management.md",
    ),
]


def clean_hugo_markdown(text: str) -> str:
    text = re.sub(r"\A---\n.*?\n---\n", "", text, flags=re.S)  # front matter
    title = ""
    text = re.sub(r"\{\{<\s*glossary_tooltip\s+[^>]*text=\"([^\"]+)\"[^>]*>\}\}", r"\1", text)
    text = re.sub(r"\{\{<\s*glossary_tooltip\s+[^>]*term_id=\"([^\"]+)\"[^>]*>\}\}", r"\1", text)
    text = re.sub(r"\{\{[<%]\s*/?\s*[^}]*[>%]\}\}", "", text)  # remaining shortcodes
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return (title + text).strip() + "\n"


def fetch(url: str) -> str:
    with urllib.request.urlopen(url, timeout=30) as resp:  # noqa: S310 (fixed https host)
        return resp.read().decode("utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true", help="re-download files that already exist")
    args = ap.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for src, name in DOCS:
        out = OUT_DIR / name
        if out.exists() and not args.force:
            print(f"skip   {name} (exists)")
            continue
        raw = fetch(RAW + src)
        header = f"Source: https://kubernetes.io/docs/{src.removesuffix('.md')}/ (CC BY 4.0)\n\n"
        out.write_text(header + clean_hugo_markdown(raw), encoding="utf-8")
        print(f"saved  {name} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
