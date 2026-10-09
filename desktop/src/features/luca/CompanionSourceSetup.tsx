import * as React from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import type {
  BrowserApproval,
  BrowserKind,
  BrowserSelection,
  MachineClass,
} from "@/shared/api/companion";
import type { CompanionSetupApi } from "./CompanionSetupDialog";

const apps = [
  ["Codex", "com.openai.codex"],
  ["Claude", "com.anthropic.claudefordesktop"],
  ["VS Code", "com.microsoft.VSCode"],
  ["Cursor", "com.todesktop.230313mzl4w4u92"],
  ["Terminal", "com.apple.Terminal"],
  ["Chrome", "com.google.Chrome"],
  ["Safari", "com.apple.Safari"],
  ["TextEdit", "com.apple.TextEdit"],
  ["Preview", "com.apple.Preview"],
] as const;

function origins(text: string, required: boolean) {
  const values = text.split(/[\s,]+/).filter(Boolean);
  if ((required && values.length === 0) || values.length > 32)
    throw new Error(
      "Choose between one and 32 exact sites, such as https://example.com. Wildcards are not supported.",
    );
  return [
    ...new Set(
      values.map((value) => {
        const url = new URL(value);
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.pathname !== "/" ||
          url.search ||
          url.hash
        )
          throw new Error(
            "Use exact HTTPS sites without paths, passwords or wildcards.",
          );
        return url.origin;
      }),
    ),
  ];
}

/** Optional source setup inside the approved chat review, never another
 * onboarding chapter. Picking/configuring leaves all observation choices OFF. */
export function CompanionSourceSetup({
  api,
  pending,
  operate,
}: {
  api: CompanionSetupApi;
  pending: boolean;
  operate: (action: (resident: string) => Promise<unknown>) => Promise<void>;
}) {
  const [section, setSection] = React.useState<"browser" | "apps" | null>(null);
  const [browser, setBrowser] = React.useState<BrowserKind>("google_chrome");
  const [selection, setSelection] = React.useState<BrowserSelection | null>(
    null,
  );
  const [approval, setApproval] = React.useState<BrowserApproval | null>(null);
  const [allowed, setAllowed] = React.useState("");
  const [excluded, setExcluded] = React.useState("");
  const [className, setClassName] =
    React.useState<MachineClass>("app_metadata");
  const [selectedApps, setSelectedApps] = React.useState<string[]>([]);
  const generation = React.useRef(0);
  const fieldId = React.useId();
  React.useEffect(() => {
    generation.current += 1;
    return () => {
      generation.current += 1;
    };
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => setSection(section === "browser" ? null : "browser")}
        >
          Browser activity
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => setSection(section === "apps" ? null : "apps")}
        >
          App activity
        </Button>
      </div>
      {section === "browser" ? (
        <div className="space-y-3 rounded-xl border border-border/50 p-4">
          <p className="text-sm font-medium">Connect one browser profile</p>
          <p className="text-xs leading-5 text-muted-foreground">
            Only new visits to your chosen sites. Bookmarks and selected
            excerpts are shared by clicking the connector. Private tabs are
            excluded; this does not scan old history.
          </p>
          <label className="block space-y-1 text-xs">
            Browser
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={browser}
              disabled={pending}
              onChange={(event) => {
                setBrowser(event.target.value as BrowserKind);
                setSelection(null);
                setApproval(null);
              }}
            >
              <option value="google_chrome">Google Chrome</option>
              <option value="chromium">Chromium</option>
              <option value="chrome_for_testing146_plus">
                Chrome for Testing (146+)
              </option>
            </select>
          </label>
          <label
            htmlFor={`${fieldId}-allowed`}
            className="block space-y-1 text-xs"
          >
            Allowed sites
            <Input
              id={`${fieldId}-allowed`}
              placeholder="https://example.com"
              value={allowed}
              disabled={pending}
              onChange={(event) => setAllowed(event.target.value)}
            />
          </label>
          <label
            htmlFor={`${fieldId}-excluded`}
            className="block space-y-1 text-xs"
          >
            Excluded sites (optional)
            <Input
              id={`${fieldId}-excluded`}
              placeholder="https://private.example.com"
              value={excluded}
              disabled={pending}
              onChange={(event) => setExcluded(event.target.value)}
            />
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              void operate(async (ownerResident) => {
                const current = generation.current;
                const picked = await api.pickCompanionBrowserProfile(
                  ownerResident,
                  browser,
                );
                if (current === generation.current) {
                  setSelection(picked);
                  setApproval(null);
                }
              })
            }
          >
            Choose profile folder
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">
            Choose the browser’s actual Default or Profile N folder. On Chrome,
            chrome://version shows its Profile Path. No access is granted by
            choosing it.
          </p>
          {selection ? (
            <>
              <p className="text-xs text-muted-foreground">
                Selected: {selection.profileName}.{" "}
                {selection.existingManifestRef
                  ? "The existing Polyphonic connector registration requires a separate native replacement confirmation."
                  : "The app will register only its own local connector."}
              </p>
              <Button
                size="sm"
                disabled={pending || !allowed.trim()}
                onClick={() =>
                  void operate(async (ownerResident) => {
                    const sites = origins(allowed, true);
                    const blocked = origins(excluded, false);
                    const current = generation.current;
                    const result = await api.connectCompanionBrowser(
                      ownerResident,
                      selection,
                      sites,
                      blocked,
                    );
                    if (current === generation.current) setApproval(result);
                  })
                }
              >
                Register connector and create pairing code
              </Button>
            </>
          ) : null}
          {approval ? (
            <div className="space-y-2" role="status">
              <p className="text-sm">
                Pairing code:{" "}
                <code className="select-all">{approval.code}</code>
              </p>
              <p className="text-xs leading-5 text-muted-foreground">
                Valid for {Math.ceil(approval.expiresInSeconds / 60)} minutes.
                Open chrome://extensions in this profile, turn on Developer
                mode, and Load unpacked from the bundled connector folder. Open
                the connector, enter this code, and approve only the sites you
                chose. Then refresh here and review each source’s access.
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  void operate(() => api.revealCompanionBrowserExtension())
                }
              >
                Show connector folder
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => void operate(async () => {})}
              >
                Refresh paired profiles
              </Button>
            </div>
          ) : null}
          <p className="text-xs leading-5 text-muted-foreground">
            Registration and pairing do not allow observation, memory or model
            sharing. Those are reviewed separately below. Some complex or
            sensitive pages are intentionally unsupported.
          </p>
        </div>
      ) : null}
      {section === "apps" ? (
        <div className="space-y-3 rounded-xl border border-border/50 p-4">
          <p className="text-sm font-medium">Choose what to follow</p>
          <label className="block space-y-1 text-xs">
            Activity type
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              disabled={pending}
              value={className}
              onChange={(event) => {
                setClassName(event.target.value as MachineClass);
                setSelectedApps([]);
              }}
            >
              <option value="app_metadata">
                App names only · changed activity
              </option>
              <option value="accessibility_text">
                Document text · one sample
              </option>
              <option value="screen_text">
                Visible document text · one sample
              </option>
            </select>
          </label>
          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="mb-2 text-xs">Allowed apps</legend>
            {apps
              .filter(
                ([, id]) =>
                  className === "app_metadata" ||
                  ["com.apple.TextEdit", "com.apple.Preview"].includes(id),
              )
              .map(([label, id]) => (
                <label key={id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={pending}
                    checked={selectedApps.includes(id)}
                    onChange={(event) =>
                      setSelectedApps(
                        event.target.checked
                          ? [...selectedApps, id]
                          : selectedApps.filter((value) => value !== id),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
          </fieldset>
          <p className="text-xs leading-5 text-muted-foreground">
            {className === "app_metadata"
              ? "Only selected app names when activity changes—not window titles, page text, screenshots or keystrokes."
              : "This candidate supports TextEdit and Preview document windows only. Each explicit resume takes one bounded sample, requires the relevant macOS permission, and rejects protected fields. It is not continuous screen recording."}
          </p>
          <Button
            size="sm"
            disabled={pending || !selectedApps.length}
            onClick={() =>
              void operate(async (ownerResident) => {
                const current = generation.current;
                await api.selectCompanionMachineSource(
                  ownerResident,
                  className,
                  selectedApps,
                );
                if (current === generation.current) setSection(null);
              })
            }
          >
            Select source · access stays off
          </Button>
        </div>
      ) : null}
    </div>
  );
}
