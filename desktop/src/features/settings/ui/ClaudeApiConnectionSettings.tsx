import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

type Status = { connected: boolean };

/** One local credential action; never echo, persist, or prefill a saved key. */
export function ClaudeApiConnectionSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [key, setKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void invoke<Status>("get_claude_api_connection").then(
      (value) => {
        if (live) setStatus(value);
      },
      () => {
        if (live) {
          setStatus({ connected: false });
          setReadFailed(true);
          setError(
            "Couldn’t read the Claude connection. You can reconnect it here.",
          );
        }
      },
    );
    return () => {
      live = false;
    };
  }, []);

  async function connect() {
    if (pending || !key.trim()) return;
    setPending(true);
    setError(null);
    setMessage(null);
    // Clear the form immediately. No toast, telemetry, localStorage or query
    // cache ever receives the key; native code returns only connected status.
    const apiKey = key.trim();
    setKey("");
    try {
      setStatus(await invoke<Status>("connect_claude_api_key", { apiKey }));
      setReadFailed(false);
      setMessage(
        "Connected. Idle Claude agents reconnect now; busy agents switch after their work finishes.",
      );
    } catch (error) {
      setError(
        typeof error === "string" ? error : "Couldn’t connect. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  async function disconnect() {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      setStatus(await invoke<Status>("disconnect_claude_api_key"));
      setReadFailed(false);
      setMessage(
        "Using your existing Claude login. Busy agents switch after their work finishes.",
      );
    } catch (error) {
      setError(
        typeof error === "string" ? error : "Couldn’t disconnect. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3" data-testid="claude-api-connection">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">Claude API key</h3>
        <span className="text-xs text-muted-foreground">
          {readFailed
            ? "Connection needs attention"
            : status
              ? status.connected
                ? "API billing connected"
                : "Using Claude login"
              : "Checking connection…"}
        </span>
      </div>
      <p
        className="max-w-prose text-sm text-muted-foreground"
        id="claude-api-help"
      >
        Use your Anthropic API credits for Claude chats and enabled background
        work in Polyphonic. Your other Claude apps and sessions keep their
        existing login.
      </p>
      <form
        className="flex flex-wrap items-start gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void connect();
        }}
      >
        <div className="min-w-48 flex-1">
          <label className="sr-only" htmlFor="claude-api-key">
            Anthropic API key
          </label>
          <Input
            id="claude-api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            aria-describedby="claude-api-help claude-api-storage"
            placeholder={
              status?.connected
                ? "Enter a replacement key"
                : "Paste your Anthropic API key"
            }
            value={key}
            onChange={(event) => setKey(event.target.value)}
            disabled={pending || !status}
          />
        </div>
        <Button
          type="submit"
          size="sm"
          disabled={pending || !status || !key.trim()}
          aria-busy={pending}
        >
          {pending
            ? "Connecting…"
            : status?.connected
              ? "Replace key"
              : "Connect"}
        </Button>
        {status?.connected ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => void disconnect()}
          >
            Use Claude login
          </Button>
        ) : null}
      </form>
      <p className="text-xs text-muted-foreground" id="claude-api-storage">
        Stored in your system’s secure credential store. API usage is billed to
        the key’s Anthropic account; available credits and spending limits are
        managed there.
      </p>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="text-sm text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
