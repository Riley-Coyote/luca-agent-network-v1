#!/usr/bin/env python3
"""Fail-closed scanner for Luca evidence artifacts.

Reports contain only a scan-local opaque artifact identifier, a classification,
and a line number. The scanner never emits a matched value, a filesystem path,
or a content-derived fingerprint. It rejects all symlinks and unsupported
entries rather than following them outside an approved scan root.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import stat
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


SCHEMA = "luca.artifact-scanner.v1"
MAX_ARTIFACT_BYTES = 16 * 1024 * 1024
CLASS_ORDER = {"secret": 0, "protected_body": 1, "absolute_path": 2}
ERROR_INPUT = "input-unavailable"
ERROR_ENTRY = "unsafe-artifact-entry"
ERROR_EMPTY = "no-regular-artifacts"
ERROR_OUTPUT = "output-unavailable"
ERROR_WRITE = "output-write-failed"

# The first expression intentionally includes exact names that the signing
# broker threat model forbids in ACP/model descendants. The suffix form covers
# provider-prefixed key, token, password, and secret variants without treating
# ordinary prose such as "token count" as a credential assignment.
SECRET_ASSIGNMENT_NAME = r"(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|BUZZ_PRIVATE_KEY|NOSTR_PRIVATE_KEY|[A-Za-z][A-Za-z0-9_-]*(?:API[_-]?KEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|PRIVATE[_-]?KEY|PASSWORD|SECRET|TOKEN)|API[_-]?KEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|PRIVATE[_-]?KEY|PASSWORD|SECRET|TOKEN)"
SECRET_ASSIGNMENT_VALUE = r"(?:\"[^\"\r\n]*\"|'[^'\r\n]*'|[^\s,;\]\}]+)"

PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("secret", re.compile(r"\bnsec1[023456789acdefghjklmnpqrstuvwxyz]{20,}\b", re.I)),
    (
        "secret",
        re.compile(
            rf"(?i)(?:\"|')?{SECRET_ASSIGNMENT_NAME}(?:\"|')?\s*[:=]\s*{SECRET_ASSIGNMENT_VALUE}"
        ),
    ),
    ("secret", re.compile(r"\bLUCATEST_(?:NSEC|PROVIDER|TOKEN|SECRET)_SENTINEL(?:_[A-Z0-9_]+)?\b")),
    ("protected_body", re.compile(r"\bLUCATEST_PROTECTED_BODY_SENTINEL(?:_[A-Z0-9_]+)?\b")),
    ("absolute_path", re.compile(r"/(?:Users|home|private|var|tmp)/[^\s\"'<>]+")),
    ("absolute_path", re.compile(r"\b[a-z]:\\(?:Users|home|private|var|tmp)\\[^\s\"'<>]+", re.I)),
    ("absolute_path", re.compile(r"\bLUCATEST_ABSOLUTE_SOURCE_PATH_SENTINEL(?:_[A-Z0-9_]+)?\b")),
)


class ScannerError(Exception):
    """A fixed, path-free scanner failure class."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


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


def _lstat(path: Path, code: str) -> os.stat_result:
    try:
        return path.lstat()
    except OSError as exc:
        raise ScannerError(code) from exc


def _reject_link_or_unsupported(path: Path, allow_directory: bool) -> os.stat_result:
    status = _lstat(path, ERROR_ENTRY)
    if stat.S_ISLNK(status.st_mode):
        raise ScannerError(ERROR_ENTRY)
    if stat.S_ISREG(status.st_mode) or (allow_directory and stat.S_ISDIR(status.st_mode)):
        return status
    raise ScannerError(ERROR_ENTRY)


def _resolved_confined(path: Path, root: Path) -> None:
    try:
        resolved = path.resolve(strict=True)
        resolved.relative_to(root)
    except (OSError, RuntimeError, ValueError) as exc:
        raise ScannerError(ERROR_ENTRY) from exc


def files_for_root(root: Path) -> Iterable[Path]:
    _reject_link_or_unsupported(root, allow_directory=True)
    try:
        resolved_root = root.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise ScannerError(ERROR_INPUT) from exc
    root_status = _lstat(root, ERROR_INPUT)
    if stat.S_ISREG(root_status.st_mode):
        yield root
        return

    try:
        candidates = sorted(root.rglob("*"))
    except OSError as exc:
        raise ScannerError(ERROR_INPUT) from exc
    for path in candidates:
        status = _reject_link_or_unsupported(path, allow_directory=True)
        _resolved_confined(path, resolved_root)
        if stat.S_ISREG(status.st_mode):
            yield path


def read_regular_file(path: Path) -> bytes:
    no_follow = getattr(os, "O_NOFOLLOW", None)
    if no_follow is None:
        raise ScannerError(ERROR_ENTRY)
    flags = os.O_RDONLY | no_follow | getattr(os, "O_CLOEXEC", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise ScannerError(ERROR_ENTRY) from exc
    try:
        status = os.fstat(descriptor)
        if not stat.S_ISREG(status.st_mode) or status.st_size > MAX_ARTIFACT_BYTES:
            raise ScannerError(ERROR_ENTRY)
        with os.fdopen(descriptor, "rb", closefd=True) as handle:
            data = handle.read(MAX_ARTIFACT_BYTES + 1)
            descriptor = -1
    except OSError as exc:
        raise ScannerError(ERROR_ENTRY) from exc
    finally:
        if descriptor >= 0:
            os.close(descriptor)
    if len(data) > MAX_ARTIFACT_BYTES:
        raise ScannerError(ERROR_ENTRY)
    return data


def find_in_text(text: str, artifact_ref: str) -> list[Finding]:
    found: list[tuple[int, int, str]] = []
    for classification, pattern in PATTERNS:
        found.extend((match.start(), match.end(), classification) for match in pattern.finditer(text))
    found.sort(key=lambda item: (item[0], item[1], CLASS_ORDER[item[2]]))

    non_overlapping: list[tuple[int, int, str]] = []
    for candidate in found:
        if not non_overlapping or non_overlapping[-1][1] <= candidate[0]:
            non_overlapping.append(candidate)
    return [
        Finding(
            classification=classification,
            artifact_ref=artifact_ref,
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
            data = read_regular_file(path)
            scanned_count += 1
            scanned_bytes += len(data)
            findings.extend(
                find_in_text(
                    data.decode("utf-8", errors="replace"),
                    f"scan-artifact:{scanned_count:06d}",
                )
            )
    if scanned_count == 0:
        raise ScannerError(ERROR_EMPTY)
    findings.sort(key=lambda item: (item.artifact_ref, item.line, CLASS_ORDER[item.classification]))
    return findings, scanned_count, scanned_bytes


def write_report(destination: Path, report: dict[str, object]) -> None:
    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        parent = destination.parent.resolve(strict=True)
        if not parent.is_dir():
            raise ScannerError(ERROR_OUTPUT)
        if destination.exists() or destination.is_symlink():
            status = destination.lstat()
            if stat.S_ISLNK(status.st_mode) or not stat.S_ISREG(status.st_mode):
                raise ScannerError(ERROR_OUTPUT)
        payload = json.dumps(report, indent=2, sort_keys=True).encode("utf-8") + b"\n"
        temporary = parent / f".{destination.name}.{uuid.uuid4().hex}.tmp"
        descriptor = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0),
            0o600,
        )
        try:
            with os.fdopen(descriptor, "wb", closefd=True) as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
                descriptor = -1
        finally:
            if descriptor >= 0:
                os.close(descriptor)
        os.replace(temporary, destination)
    except ScannerError:
        raise
    except (OSError, TypeError, ValueError) as exc:
        raise ScannerError(ERROR_WRITE) from exc


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
        expectation_met = (not findings) if args.expect == "clean" else bool(findings)
        report = {
            "schema": SCHEMA,
            "status": "PASS" if expectation_met else "FAIL",
            "mode": args.expect,
            "scanned_artifact_count": scanned_count,
            "scanned_byte_count": scanned_bytes,
            "findings": [finding.to_json() for finding in findings],
        }
        write_report(Path(args.output), report)
    except ScannerError as exc:
        print(f"FAIL: artifact-scan {exc.code}", file=sys.stderr)
        return 2
    print(
        f"artifact-scan status={report['status']} mode={args.expect} "
        f"artifacts={scanned_count} findings={len(findings)}"
    )
    return 0 if expectation_met else 1


if __name__ == "__main__":
    raise SystemExit(main())
