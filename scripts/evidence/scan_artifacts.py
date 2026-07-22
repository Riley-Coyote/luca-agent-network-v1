#!/usr/bin/env python3
"""Scan Luca evidence artifacts without disclosing matched content or paths.

The scanner is intentionally conservative. It reports only a class, a
content-derived artifact reference, and a one-based line number. It never emits
the configured root, filename, matched value, or a raw local path. Synthetic
fixtures exercise the same detector rules as gate artifacts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


SCHEMA = "luca.artifact-scanner.v1"
MAX_ARTIFACT_BYTES = 16 * 1024 * 1024
CLASS_ORDER = {"secret": 0, "protected_body": 1, "absolute_path": 2}

PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("secret", re.compile(r"\bnsec1[023456789acdefghjklmnpqrstuvwxyz]{20,}\b", re.I)),
    (
        "secret",
        re.compile(
            r"\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|private[_-]?key|secret|token)\s*[:=]\s*[^\s,;\]\}]+",
            re.I,
        ),
    ),
    ("secret", re.compile(r"\bLUCATEST_(?:NSEC|PROVIDER|TOKEN|SECRET)_SENTINEL(?:_[A-Z0-9_]+)?\b")),
    ("protected_body", re.compile(r"\bLUCATEST_PROTECTED_BODY_SENTINEL(?:_[A-Z0-9_]+)?\b")),
    ("absolute_path", re.compile(r"/(?:Users|home|private|var|tmp)/[^\s\"'<>]+")),
    ("absolute_path", re.compile(r"\b[a-z]:\\(?:Users|home|private|var|tmp)\\[^\s\"'<>]+", re.I)),
    ("absolute_path", re.compile(r"\bLUCATEST_ABSOLUTE_SOURCE_PATH_SENTINEL(?:_[A-Z0-9_]+)?\b")),
)


@dataclass(frozen=True)
class Finding:
    classification: str
    artifact_ref: str
    line: int

    def to_json(self) -> dict[str, object]:
        return {
            "classification": self.classification,
            "artifact_ref": self.artifact_ref,
            "line": self.line,
        }


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def artifact_ref(data: bytes) -> str:
    return f"sha256:{sha256_bytes(data)}"


def files_for_root(root: Path) -> Iterable[Path]:
    if root.is_file():
        yield root
        return
    if root.is_dir():
        yield from (path for path in sorted(root.rglob("*")) if path.is_file())
        return
    raise ValueError("scan input does not exist")


def find_in_text(text: str, data: bytes) -> list[Finding]:
    found: list[tuple[int, int, str]] = []
    for classification, pattern in PATTERNS:
        found.extend((match.start(), match.end(), classification) for match in pattern.finditer(text))
    found.sort(key=lambda item: (item[0], item[1], CLASS_ORDER[item[2]]))

    non_overlapping: list[tuple[int, int, str]] = []
    for candidate in found:
        if not non_overlapping or non_overlapping[-1][1] <= candidate[0]:
            non_overlapping.append(candidate)

    reference = artifact_ref(data)
    return [
        Finding(
            classification=classification,
            artifact_ref=reference,
            line=text.count("\n", 0, start) + 1,
        )
        for start, _end, classification in non_overlapping
    ]


def scan(roots: list[Path]) -> tuple[list[Finding], int, int]:
    findings: list[Finding] = []
    scanned_count = 0
    scanned_bytes = 0
    for root in roots:
        for path in files_for_root(root):
            data = path.read_bytes()
            if len(data) > MAX_ARTIFACT_BYTES:
                raise ValueError("artifact exceeds scanner byte limit")
            scanned_count += 1
            scanned_bytes += len(data)
            findings.extend(find_in_text(data.decode("utf-8", errors="replace"), data))
    findings.sort(key=lambda item: (item.artifact_ref, item.line, CLASS_ORDER[item.classification]))
    return findings, scanned_count, scanned_bytes


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", action="append", required=True, help="artifact file or directory to scan")
    parser.add_argument("--output", required=True, help="redacted JSON report destination")
    parser.add_argument(
        "--expect",
        choices=("clean", "findings"),
        default="clean",
        help="whether this invocation proves a clean gate surface or sentinel detection",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        findings, scanned_count, scanned_bytes = scan([Path(value) for value in args.root])
    except (OSError, ValueError) as exc:
        # Do not include an OS-generated path in a diagnostic.
        print(f"FAIL: scanner input unavailable ({type(exc).__name__})", file=sys.stderr)
        return 2

    expectation_met = (not findings) if args.expect == "clean" else bool(findings)
    report = {
        "schema": SCHEMA,
        "status": "PASS" if expectation_met else "FAIL",
        "mode": args.expect,
        "scanned_artifact_count": scanned_count,
        "scanned_byte_count": scanned_bytes,
        "findings": [finding.to_json() for finding in findings],
    }
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(
        f"artifact-scan status={report['status']} mode={args.expect} "
        f"artifacts={scanned_count} findings={len(findings)}"
    )
    return 0 if expectation_met else 1


if __name__ == "__main__":
    raise SystemExit(main())
