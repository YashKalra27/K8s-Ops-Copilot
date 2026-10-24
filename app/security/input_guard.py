"""L2: input guard. Scans the question for prompt injection, toxicity and banned
topics before any LLM sees it.

Backends:
- ``llm_guard``: ML scanners from the llm-guard package (most accurate, heavy).
- ``heuristic``: fast built-in rules. Used when llm-guard isn't installed, or by
  choice on small machines. The original code allowed *everything* in that case,
  which silently disabled this layer.
"""

from __future__ import annotations

import base64
import binascii
import logging
import re
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)

_INJECTION_RULES: list[tuple[str, str]] = [
    (r"\b(disregard|ignore|bypass|override)\b.{0,40}\b(instructions?|rules|guidelines|guardrails|polic(y|ies)|safety)\b", "PromptInjection"),
    (r"\b(pretend|act|behave)\s+(to\s+be|as|like)\b.{0,40}\b(unrestricted|jailbroken|evil|developer\s+mode|no\s+rules)\b", "PromptInjection"),
    (r"\b(jailbreak|DAN\s+mode|developer\s+mode)\b", "PromptInjection"),
    (r"\b(print|output|repeat|leak|dump)\b.{0,30}\b(hidden|initial|original|secret)\s+(prompt|instructions|context)\b", "PromptInjection"),
    (r"\bwhat\s+(were|are)\s+your\s+(original\s+)?instructions\b", "PromptInjection"),
]

_BANNED_TOPIC_RULES: list[tuple[str, str]] = [
    (r"\b(build|make|assemble|construct)\b.{0,30}\b(bomb|explosive|detonator|weapon)s?\b", "BanTopics"),
    (r"\b(kill|hurt|harm)\s+(myself|yourself|someone|people)\b|\bsuicide\b|\bself[- ]harm\b", "BanTopics"),
    (r"\b(write|create|build)\b.{0,30}\b(malware|ransomware|keylogger|botnet)\b", "BanTopics"),
]

_TOXIC_RULES: list[tuple[str, str]] = [
    (r"\b(f+u+c+k+\s+you|piece\s+of\s+shit|retard(ed)?|kill\s+yourself)\b", "Toxicity"),
]


def _decoded_variants(text: str) -> list[str]:
    """Also scan base64-looking tokens, a common trick to slip past keyword rules."""
    variants = [text]
    for token in re.findall(r"[A-Za-z0-9+/]{16,}={0,2}", text):
        try:
            decoded = base64.b64decode(token, validate=True).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError, ValueError):
            continue
        if decoded.isprintable():
            variants.append(decoded)
    return variants


def heuristic_scan(text: str) -> dict[str, Any]:
    failed: list[str] = []
    for variant in _decoded_variants(text):
        for rules in (_INJECTION_RULES, _BANNED_TOPIC_RULES, _TOXIC_RULES):
            for pattern, name in rules:
                if name not in failed and re.search(pattern, variant, flags=re.IGNORECASE):
                    failed.append(name)
    return {
        "is_safe": not failed,
        "failed_checks": failed,
        "scores": {name: 1.0 for name in failed},
        "sanitized": text,
        "backend": "heuristic",
    }


def _load_guard() -> Any | None:
    """Try to import llm-guard scanner; return None if unavailable."""
    if settings.input_guard_backend == "heuristic":
        return None
    try:
        from llm_guard import scan_prompt

        return scan_prompt
    except Exception:
        logger.info("llm-guard not available; input guard uses heuristic rules")
        return None


_SCAN_PROMPT = _load_guard()
_scanners: list[Any] | None = None


def _get_scanners() -> list[Any]:
    """Lazy-build llm-guard input scanner instances from settings."""
    global _scanners
    if _scanners is not None:
        return _scanners

    from llm_guard.input_scanners import BanTopics, PromptInjection, TokenLimit, Toxicity

    wanted = {s.strip() for s in settings.llm_guard_scanners.split(",") if s.strip()}
    scanners: list[Any] = []
    if "prompt_injection" in wanted:
        scanners.append(PromptInjection(threshold=settings.prompt_injection_threshold))
    if "toxicity" in wanted:
        scanners.append(Toxicity(threshold=settings.toxicity_threshold))
    if "ban_topics" in wanted:
        scanners.append(
            BanTopics(
                topics=["violence", "self-harm", "illegal activities"],
                threshold=settings.toxicity_threshold,
            )
        )
    scanners.append(TokenLimit(limit=4096))
    _scanners = scanners
    return _scanners


def guard_backend() -> str:
    return "llm_guard" if _SCAN_PROMPT is not None else "heuristic"


def warmup() -> None:
    if _SCAN_PROMPT is not None:
        _get_scanners()


def scan_input(text: str) -> dict[str, Any]:
    # Heuristic rules always run: they are cheap and catch obvious cases (including
    # base64-wrapped ones) even when an ML scanner scores them as borderline.
    heuristic = heuristic_scan(text)
    if _SCAN_PROMPT is None or not heuristic["is_safe"]:
        return heuristic

    try:
        scanners = _get_scanners()
        sanitized, is_valid, scores = _SCAN_PROMPT(scanners, text)
        failed = [name for name, valid in is_valid.items() if not valid]
        return {
            "is_safe": len(failed) == 0,
            "failed_checks": failed,
            "scores": dict(scores),
            "sanitized": str(sanitized),
            "backend": "llm_guard",
        }
    except Exception:
        logger.exception("llm-guard scan failed; using heuristic result")
        return heuristic


def check_input_safe(text: str) -> tuple[bool, str | None]:
    result = scan_input(text)
    if result["is_safe"]:
        return True, None

    checks = ", ".join(result["failed_checks"]) if result["failed_checks"] else "security scan"
    return False, f"Input blocked by {checks}"
