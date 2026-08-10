import * as React from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  Activity,
  CheckCircle2,
  Copy,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";

import { UpdateChecker } from "@/features/settings/UpdateChecker";
import {
  listLucaMcpRegistry,
  listRuntimeConnectionStatus,
  type LucaMcpRegistryV1,
  type RuntimeConnectionStatusV1,
} from "@/shared/api/tauriMcp";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { Button } from "@/shared/ui/button";
import { AgentDefaultsSettingsCard } from "./AgentDefaultsSettingsCard";
import { MobilePairingCard } from "./MobilePairingCard";
import { PreventSleepSettingsCard } from "./PreventSleepSettingsCard";
import { ProtectedOwnerBackupRow } from "./ProtectedOwnerBackupRow";
import { SettingsOptionGroup, SettingsOptionRow } from "./SettingsOptionGroup";
import { SettingsSectionHeader } from "./SettingsSectionHeader";

export function SecurityBackupSettings() {
  return (
    <section className="min-w-0" data-testid="settings-security-backup">
      <SettingsSectionHeader
        description="Protect your owner identity and recovery material on this Mac. Luca never displays or copies your private signing key."
        title="Security & backup"
      />
      <SettingsOptionGroup>
        <SettingsOptionRow>
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted/50">
              <KeyRound className="size-4 text-muted-foreground" />
            </span>
            <div>
              <p className="text-sm font-medium">Native secure storage</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Identity and Luca-owned secret references are held by the OS
                keychain.
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="size-3.5" /> Active
          </span>
        </SettingsOptionRow>
        <div className="border-t border-border/50">
          <ProtectedOwnerBackupRow />
        </div>
      </SettingsOptionGroup>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        Device reset remains under Profile & identity so destructive identity
        actions stay next to the identity they affect.
      </p>
    </section>
  );
}

export function MobileDevicesSettings({
  currentPubkey,
}: {
  currentPubkey?: string;
}) {
  return <MobilePairingCard currentPubkey={currentPubkey} />;
}

export function DefaultsPermissionsSettings() {
  return (
    <div className="space-y-10" data-testid="settings-defaults-permissions">
      <section>
        <SettingsSectionHeader
          description="Choose defaults for newly created or inheriting agents. Existing explicit agent settings are never overwritten."
          title="Defaults & permissions"
        />
        <SettingsOptionGroup>
          <SettingsOptionRow>
            <div>
              <p className="text-sm font-medium">
                Fail-closed tool permissions
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Protected actions require a matching approval. MCP grants never
                grant tool approval.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" /> Required
            </span>
          </SettingsOptionRow>
          <SettingsOptionRow className="border-t border-border/50">
            <div>
              <p className="text-sm font-medium">Continuity for new agents</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Keep a small encrypted Luca handoff separate from native agent
                memory.
              </p>
            </div>
            <span className="text-xs text-muted-foreground">
              Enabled by default
            </span>
          </SettingsOptionRow>
        </SettingsOptionGroup>
      </section>
      <PreventSleepSettingsCard />
      <AgentDefaultsSettingsCard />
    </div>
  );
}

export function DiagnosticsSettings() {
  const [runtimes, setRuntimes] = React.useState<RuntimeConnectionStatusV1[]>(
    [],
  );
  const [registry, setRegistry] = React.useState<LucaMcpRegistryV1 | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setError(null);
    try {
      const [nextRuntimes, nextRegistry] = await Promise.all([
        listRuntimeConnectionStatus(),
        listLucaMcpRegistry(),
      ]);
      setRuntimes(nextRuntimes);
      setRegistry(nextRegistry);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Diagnostics are unavailable.",
      );
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const diagnostic = React.useMemo(
    () =>
      JSON.stringify(
        {
          runtimeConnections: runtimes.map(
            ({ runtimeId, readiness, authentication, reason }) => ({
              runtimeId,
              readiness,
              authentication,
              reason,
            }),
          ),
          mcp: registry
            ? {
                connections: registry.connections.length,
                grants: registry.grants.length,
                health: registry.health.map(
                  ({ connectionId, readiness, errorCode }) => ({
                    connectionId,
                    readiness,
                    errorCode,
                  }),
                ),
              }
            : null,
          error,
        },
        null,
        2,
      ),
    [error, registry, runtimes],
  );

  return (
    <section className="min-w-0" data-testid="settings-diagnostics">
      <SettingsSectionHeader
        action={
          <Button onClick={() => void refresh()} size="sm" variant="outline">
            Recheck
          </Button>
        }
        description="Body-free application, runtime, continuity, Brain, mobile, and MCP status for troubleshooting."
        title="Diagnostics"
      />
      <SettingsOptionGroup>
        <SettingsOptionRow>
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-full bg-muted/50">
              <Activity className="size-4 text-muted-foreground" />
            </span>
            <div>
              <p className="text-sm font-medium">Local agent system</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {
                  runtimes.filter((runtime) => runtime.readiness === "ready")
                    .length
                }{" "}
                of {runtimes.length} runtime connections ready
              </p>
            </div>
          </div>
          <Button
            onClick={async () => {
              await writeTextToClipboard(diagnostic);
            }}
            size="sm"
            variant="ghost"
          >
            <Copy className="mr-1.5 size-3.5" /> Copy diagnostics
          </Button>
        </SettingsOptionRow>
        <SettingsOptionRow className="border-t border-border/50">
          <div className="flex items-center gap-3">
            <LockKeyhole className="size-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Diagnostics exclude message bodies, Notebook content, prompts, and
              secret values.
            </p>
          </div>
        </SettingsOptionRow>
      </SettingsOptionGroup>
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
    </section>
  );
}

export function UpdatesSettings() {
  return <UpdateChecker />;
}

export function AboutLucaSettings() {
  const [version, setVersion] = React.useState<string | null>(null);
  React.useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  return (
    <section className="min-w-0" data-testid="settings-about-luca">
      <SettingsSectionHeader
        description="Build identity, acknowledgements, licenses, and required third-party notices."
        title="About Luca"
      />
      <SettingsOptionGroup>
        <SettingsOptionRow>
          <div>
            <p className="text-sm font-medium">Luca Agent Network</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              Version {version ?? "unavailable"}
            </p>
          </div>
        </SettingsOptionRow>
        <details className="border-t border-border/50">
          <summary className="cursor-pointer list-none px-4 py-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            Third-party notices
          </summary>
          <div className="space-y-3 border-t border-border/45 px-4 py-4 text-sm leading-6 text-muted-foreground">
            <p>
              Luca includes open-source software developed by Block, Inc. and
              other contributors. Required copyrights and license notices are
              preserved with this distribution.
            </p>
            <p>
              The upstream Buzz collaboration project is licensed under the
              Apache License 2.0. Buzz is acknowledged here solely as required
              third-party attribution and is not the Luca product name.
            </p>
          </div>
        </details>
      </SettingsOptionGroup>
    </section>
  );
}
