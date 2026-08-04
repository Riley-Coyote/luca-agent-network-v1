#!/usr/bin/env python3
"""Deterministic ACP runtime for live crash and frozen-final recovery proofs."""

from __future__ import annotations

import json
import os
import re
import sys
import time
import uuid


def send(payload: dict[str, object]) -> None:
    print(json.dumps(payload, separators=(",", ":")), flush=True)


def respond(request_id: object, result: dict[str, object]) -> None:
    send({"jsonrpc": "2.0", "id": request_id, "result": result})


def log(message: str) -> None:
    print(f"g1-recovery-fixture: {message}", file=sys.stderr, flush=True)


def emit_chunk(session_id: str, text: str) -> None:
    send(
        {
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": session_id,
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": {"type": "text", "text": text},
                },
            },
        }
    )


def current_event_content(params: object) -> str:
    """Extract the final event block instead of matching bounded history."""

    texts: list[str] = []

    def collect(value: object) -> None:
        if isinstance(value, str):
            texts.append(value)
        elif isinstance(value, list):
            for item in value:
                collect(item)
        elif isinstance(value, dict):
            for item in value.values():
                collect(item)

    collect(params)
    matches: list[str] = []
    for text in texts:
        matches.extend(
            match.group(1).strip()
            for match in re.finditer(r"(?:^|\n)Content: (.*?)(?:\nTags:|\n|$)", text)
        )
    return matches[-1] if matches else ""


def main() -> int:
    session_id = f"g1-recovery-session-{uuid.uuid4()}"
    for raw_line in sys.stdin:
        try:
            message = json.loads(raw_line)
        except json.JSONDecodeError:
            log("ignored malformed JSON")
            continue

        method = message.get("method")
        request_id = message.get("id")

        if method == "initialize":
            respond(
                request_id,
                {
                    "protocolVersion": 1,
                    "agentCapabilities": {
                        "promptCapabilities": {"embeddedContext": True},
                        "sessionCapabilities": {},
                    },
                    "agentInfo": {
                        "name": "luca-g1-managed-recovery-fixture",
                        "title": "Luca G1 Recovery Fixture",
                        "version": "1.0.0",
                    },
                    "authMethods": [],
                },
            )
            continue

        if method == "session/new":
            respond(request_id, {"sessionId": session_id})
            continue

        if method == "session/prompt":
            prompt = current_event_content(message.get("params", {}))
            if "G1_APP_CRASH_DURING_GENERATION" in prompt:
                log("emitting partial output, then holding for app-crash proof")
                emit_chunk(session_id, "Partial output before simulated app crash.")
                time.sleep(30)
                emit_chunk(session_id, "This final must never survive the app crash.")
                respond(request_id, {"stopReason": "end_turn"})
                continue

            if "G1_CRASH_DURING_GENERATION" in prompt:
                log("emitting partial output, then exiting with status 42")
                emit_chunk(session_id, "Partial output before simulated runtime crash.")
                time.sleep(0.25)
                os._exit(42)

            if prompt.startswith("G1_FROZEN_FINAL_"):
                log("delaying final for relay interruption window")
                time.sleep(8)
                emit_chunk(session_id, prompt)
                respond(request_id, {"stopReason": "end_turn"})
                log("submitted deterministic final to managed publication path")
                continue

            emit_chunk(session_id, "Recovery fixture ready.")
            respond(request_id, {"stopReason": "end_turn"})
            continue

        if method == "session/cancel":
            log("received session/cancel")
            continue

        if method == "session/close":
            respond(request_id, {})
            continue

        if request_id is not None:
            send(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {"code": -32601, "message": "Method not found"},
                }
            )

    log("stdin closed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
