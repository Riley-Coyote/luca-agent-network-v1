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


def _no_follow_flags() -> int:
    no_follow = getattr(os, "O_NOFOLLOW", None)
    if no_follow is None:
        raise ScannerError(ERROR_ENTRY)
    return no_follow | getattr(os, "O_CLOEXEC", 0)


def _read_regular_descriptor(descriptor: int) -> bytes:
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


def _open_child(parent_fd: int, name: str, directory: bool = False) -> int:
    flags = os.O_RDONLY | _no_follow_flags()
    if directory:
        flags |= getattr(os, "O_DIRECTORY", 0)
    try:
        descriptor = os.open(name, flags, dir_fd=parent_fd)
    except OSError as exc:
        raise ScannerError(ERROR_ENTRY) from exc
    try:
        status = os.fstat(descriptor)
        if directory and not stat.S_ISDIR(status.st_mode):
            raise ScannerError(ERROR_ENTRY)
        if not directory and not stat.S_ISREG(status.st_mode):
            raise ScannerError(ERROR_ENTRY)
        return descriptor
    except ScannerError:
        os.close(descriptor)
        raise


def _read_directory_artifacts(directory_fd: int) -> list[bytes]:
    artifacts: list[bytes] = []
    try:
        names = sorted(os.listdir(directory_fd))
    except OSError as exc:
        raise ScannerError(ERROR_ENTRY) from exc
    for name in names:
        try:
            status = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        except OSError as exc:
            raise ScannerError(ERROR_ENTRY) from exc
        if stat.S_ISLNK(status.st_mode):
            raise ScannerError(ERROR_ENTRY)
        if stat.S_ISREG(status.st_mode):
            artifacts.append(_read_regular_descriptor(_open_child(directory_fd, name)))
        elif stat.S_ISDIR(status.st_mode):
            child_fd = _open_child(directory_fd, name, directory=True)
            try:
                artifacts.extend(_read_directory_artifacts(child_fd))
            finally:
                os.close(child_fd)
        else:
            raise ScannerError(ERROR_ENTRY)
    return artifacts


def read_root_artifacts(root: Path) -> list[bytes]:
    try:
        root_fd = os.open(root, os.O_RDONLY | _no_follow_flags())
    except OSError as exc:
        raise ScannerError(ERROR_INPUT) from exc
    try:
        status = os.fstat(root_fd)
        if stat.S_ISREG(status.st_mode):
            artifacts = [_read_regular_descriptor(root_fd)]
            root_fd = -1
            return artifacts
        if not stat.S_ISDIR(status.st_mode):
            raise ScannerError(ERROR_ENTRY)
        artifacts = _read_directory_artifacts(root_fd)
        return artifacts
    finally:
        if root_fd >= 0:
            os.close(root_fd)


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
        for data in read_root_artifacts(root):
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
        requested_parent = destination.parent
        parent_before = requested_parent.lstat()
        parent = requested_parent.resolve(strict=True)
        # macOS exposes /tmp and /var as OS-owned compatibility aliases for
        # /private/*; they are not user-configurable output destinations. Every
        # other requested-parent symlink is rejected before writing.
        system_alias = requested_parent in (Path("/tmp"), Path("/var")) and parent in (
            Path("/private/tmp"),
            Path("/private/var"),
        )
        if not system_alias and (
            stat.S_ISLNK(parent_before.st_mode) or not stat.S_ISDIR(parent_before.st_mode)
        ):
            raise ScannerError(ERROR_OUTPUT)
        if system_alias:
            parent_before = parent.lstat()
        parent_fd = os.open(parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | _no_follow_flags())
        try:
            status = os.fstat(parent_fd)
            if (
                not stat.S_ISDIR(status.st_mode)
                or status.st_dev != parent_before.st_dev
                or status.st_ino != parent_before.st_ino
            ):
                raise ScannerError(ERROR_OUTPUT)
            try:
                destination_status = os.stat(destination.name, dir_fd=parent_fd, follow_symlinks=False)
            except FileNotFoundError:
                destination_status = None
            if destination_status is not None:
                status = destination_status
                if stat.S_ISLNK(status.st_mode) or not stat.S_ISREG(status.st_mode):
                    raise ScannerError(ERROR_OUTPUT)
            payload = json.dumps(report, indent=2, sort_keys=True).encode("utf-8") + b"\n"
            temporary_name = f".{destination.name}.{uuid.uuid4().hex}.tmp"
            descriptor = os.open(
                temporary_name,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | _no_follow_flags(),
                0o600,
                dir_fd=parent_fd,
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
            os.replace(temporary_name, destination.name, src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
        finally:
            os.close(parent_fd)
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
