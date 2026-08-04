#!/usr/bin/env python3
"""Deterministic ACP runtime for live managed-permission verification.

This fixture deliberately emits a real ``session/request_permission`` request
for every prompt. It exercises the production buzz-acp process, inherited
local permission socket, desktop registry, Tauri commands, and approval-card
UI without relying on a provider whose own policy silently bypasses ACP.

Only newline-delimited JSON-RPC is written to stdout. Human-readable evidence
is written to stderr so it is captured in the resident harness log.
"""

from __future__ import annotations

import json
import sys
import uuid


PROTOCOL_VERSION = 1


def send(payload: dict[str, object]) -> None:
    print(json.dumps(payload, separators=(",", ":")), flush=True)


def respond(request_id: object, result: dict[str, object]) -> None:
    send({"jsonrpc": "2.0", "id": request_id, "result": result})


def log(message: str) -> None:
    print(f"g1-permission-fixture: {message}", file=sys.stderr, flush=True)


def main() -> int:
    session_id = f"g1-session-{uuid.uuid4()}"
    pending_permissions: dict[str, dict[str, object]] = {}
    prompt_by_permission: dict[str, object] = {}

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
                    "protocolVersion": PROTOCOL_VERSION,
                    "agentCapabilities": {
                        "promptCapabilities": {"embeddedContext": True},
                        "sessionCapabilities": {},
                    },
                    "agentInfo": {
                        "name": "luca-g1-managed-permission-fixture",
                        "title": "Luca G1 Permission Fixture",
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
            permission_id = f"g1-permission-{uuid.uuid4()}"
            option_tag = uuid.uuid4().hex[:12]
            pending_permissions[permission_id] = {
                "sessionId": message.get("params", {}).get("sessionId", session_id)
            }
            prompt_by_permission[permission_id] = request_id
            send(
                {
                    "jsonrpc": "2.0",
                    "id": permission_id,
                    "method": "session/request_permission",
                    "params": {
                        "sessionId": session_id,
                        "toolCall": {
                            "toolCallId": f"g1-tool-{uuid.uuid4()}",
                            "title": "Verify Luca managed permission lifecycle",
                            "kind": "other",
                            "status": "pending",
                        },
                        "options": [
                            {
                                "optionId": f"g1-allow-once-{option_tag}",
                                "name": "Allow this verification once",
                                "kind": "allow_once",
                            },
                            {
                                "optionId": f"g1-reject-once-{option_tag}",
                                "name": "Reject this verification",
                                "kind": "reject_once",
                            },
                        ],
                    },
                }
            )
            log(
                f"requested {permission_id} "
                f"options=g1-allow-once-{option_tag},g1-reject-once-{option_tag}"
            )
            continue

        if method == "session/cancel":
            log("received session/cancel")
            continue

        if method == "session/close":
            respond(request_id, {})
            continue

        if method is None and request_id in pending_permissions:
            permission_id = str(request_id)
            outcome = message.get("result", {}).get("outcome", {})
            log(f"resolved {permission_id}: {json.dumps(outcome, sort_keys=True)}")
            prompt_id = prompt_by_permission.pop(permission_id)
            pending_permissions.pop(permission_id, None)
            send(
                {
                    "jsonrpc": "2.0",
                    "method": "session/update",
                    "params": {
                        "sessionId": session_id,
                        "update": {
                            "sessionUpdate": "agent_message_chunk",
                            "content": {
                                "type": "text",
                                "text": "Permission verification completed.",
                            },
                        },
                    },
                }
            )
            respond(prompt_id, {"stopReason": "end_turn"})
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
