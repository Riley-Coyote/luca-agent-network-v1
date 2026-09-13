import { useArtifactCanvas } from "@/features/artifacts/ArtifactCanvasProvider";
import { useCommunities } from "@/features/communities/useCommunities";
import { useResidentPlace } from "@/features/agents/place/useResidentPlace";
import { useIdentityQuery } from "@/shared/api/hooks";
import type {
  ResidentPlaceContent,
  ResidentPlaceWorkView,
} from "@/shared/api/tauriResidentPlace";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";

export function ResidentPlaceSection({
  residentPubkey,
  residentName,
}: {
  residentPubkey: string;
  residentName: string;
}) {
  const identity = useIdentityQuery();
  const { activeCommunity, reinitKey } = useCommunities();
  const ownerPubkey = identity.data?.pubkey;
  if (!ownerPubkey || !activeCommunity || identity.isPending) {
    return (
      <p className="text-sm text-muted-foreground">Opening private place…</p>
    );
  }
  return (
    <ScopedResidentPlace
      key={`${ownerPubkey}:${activeCommunity.id}:${reinitKey}:${residentPubkey}`}
      residentName={residentName}
      residentPubkey={residentPubkey}
    />
  );
}

function ScopedResidentPlace({
  residentPubkey,
  residentName,
}: {
  residentPubkey: string;
  residentName: string;
}) {
  const state = useResidentPlace(residentPubkey);
  const { openArtifact } = useArtifactCanvas();
  const place = state.place;
  const draft = state.draft;

  if (state.loading && !place) {
    return (
      <p className="text-sm text-muted-foreground">Opening private place…</p>
    );
  }
  if (!place) {
    return (
      <div className="max-w-2xl" data-testid="resident-place">
        <p className="text-sm text-destructive" role="alert">
          {state.readError ?? "Couldn’t open this place."}
        </p>
        <Button
          className="mt-4"
          onClick={() => void state.refresh()}
          size="sm"
          variant="outline"
        >
          Try again
        </Button>
      </div>
    );
  }

  const content = place.content;
  const isEmpty =
    !content.introduction.trim() &&
    !content.exploration.trim() &&
    !content.selectedWork;
  const selected = place.selectedWork;
  const selectedAvailable =
    selected?.availability === "available" &&
    selected.artifactId === content.selectedWork?.artifactId &&
    selected.version === content.selectedWork?.version;
  const authorLabel =
    place.author?.kind === "resident"
      ? `Written by ${residentName}`
      : place.author?.kind === "owner"
        ? "Edited by you"
        : null;

  return (
    <section
      aria-labelledby="resident-place-title"
      className="mx-auto w-full max-w-2xl pb-10"
      data-testid="resident-place"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/55 pb-6">
        <div>
          <p className="text-2xs uppercase tracking-caps-wide text-ink-faint">
            Private place
          </p>
          <h2
            className="mt-2 text-xl font-medium tracking-tight text-foreground"
            id="resident-place-title"
          >
            Place
          </h2>
          {authorLabel ? (
            <p
              className="mt-2 text-xs text-muted-foreground"
              data-testid="resident-place-author"
            >
              {authorLabel}
              {place.updatedAt ? ` · ${formatUpdatedAt(place.updatedAt)}` : ""}{" "}
              · revision {place.revision}
            </p>
          ) : null}
        </div>
        {!draft ? (
          <Button onClick={state.beginEdit} size="sm" variant="outline">
            Edit place
          </Button>
        ) : null}
      </div>

      {state.readError ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {state.readError}
        </p>
      ) : null}

      {draft ? (
        <form
          className="pt-7"
          data-testid="resident-place-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void state.save();
          }}
        >
          <p className="mb-7 text-sm leading-6 text-muted-foreground">
            Shape what appears in this private space. Your edits will be
            attributed to you.
          </p>
          <label
            className="block text-sm font-medium text-foreground"
            htmlFor="place-introduction"
          >
            Introduction
          </label>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            A deliberate introduction, shown as the main text on this page.
          </p>
          <textarea
            className="mt-3 min-h-36 w-full resize-y rounded-md border border-border/70 bg-background/50 px-3 py-2 text-base leading-6 text-foreground focus-visible:border-foreground/50 focus-visible:outline-hidden"
            disabled={state.saving}
            id="place-introduction"
            maxLength={1200}
            onChange={(event) =>
              state.changeContent({
                ...draft.content,
                introduction: event.target.value,
              })
            }
            placeholder="Write an introduction"
            value={draft.content.introduction}
          />
          <p className="mt-1 text-right text-2xs tabular-nums text-ink-faint">
            {draft.content.introduction.length} / 1200
          </p>

          <label
            className="mt-7 block text-sm font-medium text-foreground"
            htmlFor="place-exploration"
          >
            Exploring
          </label>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            An authored statement of interest. It does not indicate live
            activity.
          </p>
          <textarea
            className="mt-3 min-h-28 w-full resize-y rounded-md border border-border/70 bg-background/50 px-3 py-2 text-base leading-6 text-foreground focus-visible:border-foreground/50 focus-visible:outline-hidden"
            disabled={state.saving}
            id="place-exploration"
            maxLength={1600}
            onChange={(event) =>
              state.changeContent({
                ...draft.content,
                exploration: event.target.value,
              })
            }
            placeholder="Write what is being explored"
            value={draft.content.exploration}
          />
          <p className="mt-1 text-right text-2xs tabular-nums text-ink-faint">
            {draft.content.exploration.length} / 1600
          </p>

          <div className="mt-7 border-t border-border/45 pt-6">
            <label
              className="block text-sm font-medium text-foreground"
              htmlFor="place-selected-work"
            >
              Selected work
            </label>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Choose one existing version. New versions will not replace it
              automatically.
            </p>
            {state.work ? (
              <WorkSelect
                choices={state.work}
                content={draft.content}
                disabled={state.saving}
                onChange={state.changeContent}
              />
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  {draft.content.selectedWork
                    ? selectedAvailable
                      ? `${selected.title} · version ${selected.version}`
                      : `Version ${draft.content.selectedWork.version} unavailable`
                    : "No work selected"}
                </p>
                <Button
                  disabled={state.workLoading || state.saving}
                  onClick={() => void state.loadWork()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {state.workLoading ? "Loading work…" : "Choose work"}
                </Button>
                {draft.content.selectedWork ? (
                  <Button
                    disabled={state.saving}
                    onClick={() =>
                      state.changeContent({
                        ...draft.content,
                        selectedWork: null,
                      })
                    }
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
            )}
            {state.workError ? (
              <p className="mt-2 text-xs text-destructive" role="alert">
                {state.workError}
              </p>
            ) : null}
          </div>

          {state.conflict || place.revision !== draft.expectedRevision ? (
            <div
              className="mt-7 border-l-2 border-foreground/40 pl-4 text-sm text-muted-foreground"
              role="alert"
            >
              <p>
                This place changed while you were editing. Your draft remains
                here. Reload latest replaces it with the current version.
              </p>
              <Button
                className="mt-3"
                disabled={state.saving || state.loading}
                onClick={() => void state.reloadLatest()}
                size="sm"
                type="button"
                variant="outline"
              >
                Reload latest
              </Button>
            </div>
          ) : null}
          {state.saveError ? (
            <p className="mt-5 text-sm text-destructive" role="alert">
              {state.saveError}
            </p>
          ) : null}
          <div className="mt-8 flex flex-wrap gap-2 border-t border-border/55 pt-5">
            <Button
              disabled={
                state.saving ||
                state.conflict ||
                place.revision !== draft.expectedRevision
              }
              size="sm"
              type="submit"
            >
              {state.saving ? "Saving…" : "Save place"}
            </Button>
            <Button
              disabled={state.saving}
              onClick={state.cancelEdit}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div>
          {isEmpty ? (
            <div className="py-10" data-testid="resident-place-empty">
              <p className="text-base leading-7 text-foreground">
                Nothing has been written here yet.
              </p>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                This private place can hold an introduction, a note about what
                is being explored, and one chosen piece of work.
              </p>
            </div>
          ) : (
            <>
              {content.introduction.trim() ? (
                <div className="border-b border-border/45 py-8">
                  <p className="mb-4 text-2xs uppercase tracking-caps-wide text-ink-faint">
                    Introduction
                  </p>
                  <p
                    className="whitespace-pre-wrap break-words text-base leading-8 text-foreground"
                    data-testid="resident-place-introduction"
                  >
                    {content.introduction}
                  </p>
                </div>
              ) : null}
              {content.exploration.trim() ? (
                <div className="border-b border-border/45 py-7">
                  <h3 className="text-2xs uppercase tracking-caps-wide text-ink-faint">
                    Exploring
                  </h3>
                  <p
                    className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-ink-muted"
                    data-testid="resident-place-exploration"
                  >
                    {content.exploration}
                  </p>
                </div>
              ) : null}
              {content.selectedWork ? (
                <div
                  className="py-7"
                  data-testid="resident-place-selected-work"
                >
                  <h3 className="text-2xs uppercase tracking-caps-wide text-ink-faint">
                    Selected work
                  </h3>
                  {selectedAvailable ? (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="break-words text-base text-foreground">
                          {selected.title}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {selected.kind} · version {selected.version}
                        </p>
                      </div>
                      <Button
                        onClick={() =>
                          openArtifact({
                            artifactId: selected.artifactId,
                            version: selected.version,
                            previewSessionId: null,
                            conversationId: selected.conversationId,
                            residentPubkey,
                            turnId: null,
                            source: "library",
                          })
                        }
                        size="sm"
                        variant="outline"
                      >
                        Open
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
                      <p className="text-sm text-muted-foreground">
                        Selected work is unavailable.
                      </p>
                      <Button disabled size="sm" variant="outline">
                        Open
                      </Button>
                    </div>
                  )}
                </div>
              ) : null}
            </>
          )}
          {state.saveError ? (
            <p className="mb-5 text-sm text-destructive" role="alert">
              {state.saveError}
            </p>
          ) : null}
          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-border/55 pt-6">
            <div className="max-w-lg">
              <p className="text-sm font-medium text-foreground">
                Let {residentName} edit this place
              </p>
              <p
                className="mt-1 text-xs leading-5 text-muted-foreground"
                id="place-editing-description"
              >
                Allow {residentName} to update their introduction, exploration,
                and selected work during a conversation.
              </p>
            </div>
            <Switch
              aria-label={`Let ${residentName} edit this place`}
              aria-describedby="place-editing-description"
              checked={place.residentEditingEnabled}
              disabled={state.switching}
              onCheckedChange={() => void state.toggleEditing()}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function WorkSelect({
  choices,
  content,
  disabled,
  onChange,
}: {
  choices: ResidentPlaceWorkView[];
  content: ResidentPlaceContent;
  disabled: boolean;
  onChange: (content: ResidentPlaceContent) => void;
}) {
  const selectedIndex = choices.findIndex(
    (choice) =>
      choice.artifactId === content.selectedWork?.artifactId &&
      choice.version === content.selectedWork?.version,
  );
  const value = content.selectedWork
    ? selectedIndex < 0
      ? "current"
      : String(selectedIndex)
    : "";
  return (
    <select
      className="mt-3 h-10 w-full max-w-xl rounded-md border border-border/70 bg-background px-3 text-sm text-foreground focus-visible:border-foreground/50 focus-visible:outline-hidden"
      disabled={disabled}
      id="place-selected-work"
      onChange={(event) => {
        const index = Number(event.target.value);
        const choice =
          event.target.value === "" || event.target.value === "current"
            ? null
            : choices[index];
        onChange({
          ...content,
          selectedWork: choice
            ? { artifactId: choice.artifactId, version: choice.version }
            : null,
        });
      }}
      value={value}
    >
      <option value="">No selected work</option>
      {value === "current" ? (
        <option value="current">
          Current selection unavailable · version{" "}
          {content.selectedWork?.version}
        </option>
      ) : null}
      {choices.map((choice, index) => (
        <option
          disabled={choice.availability !== "available"}
          key={`${choice.artifactId}:${choice.version}`}
          value={String(index)}
        >
          {choice.availability === "available"
            ? choice.title
            : "Unavailable work"}{" "}
          · version {choice.version}
        </option>
      ))}
    </select>
  );
}

function formatUpdatedAt(timestamp: number): string {
  const date = new Date(
    timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp,
  );
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(date);
}
