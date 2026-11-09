import * as React from "react";
import { Inbox } from "lucide-react";
import { useAgentInbox } from "@/features/exchange/useAgentInbox";
import { useSideConversations } from "@/features/exchange/useSideConversations";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

function InboxContents({
  residentPubkey,
  onOpen,
}: {
  residentPubkey: string;
  onOpen: () => void;
}) {
  const query = useAgentInbox(residentPubkey);
  const { goCorrespondence } = useAppNavigation();
  const { nameOf } = useSideConversations();
  const pairs = new Map<string, { id: string; label: string }>();
  for (const page of query.data?.pages ?? [])
    for (const task of page.tasks) {
      if (!task.correspondenceId || pairs.has(task.correspondenceId)) continue;
      const other = task.record.members.find((key) => key !== residentPubkey);
      pairs.set(task.correspondenceId, {
        id: task.record.exchangeId,
        label: `With ${other ? nameOf(other) : "agent"}`,
      });
    }
  return (
    <section className="flex flex-col gap-1" aria-label="Agent inbox">
      {query.isPending ? (
        <p className="p-2 text-sm text-muted-foreground" role="status">
          Loading inbox…
        </p>
      ) : null}
      {query.isError ? (
        <p className="p-2 text-sm text-muted-foreground" role="alert">
          Inbox unavailable.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => void query.refetch()}
          >
            Retry
          </button>
        </p>
      ) : null}
      {!query.isPending && !query.isError && pairs.size === 0 ? (
        <p className="p-2 text-sm text-muted-foreground">
          No correspondence yet.
        </p>
      ) : null}
      {[...pairs].map(([id, pair]) => (
        <button
          key={id}
          type="button"
          className="rounded-md px-3 py-2 text-left text-sm hover:bg-plate focus-visible:outline focus-visible:outline-2"
          onClick={() => {
            void goCorrespondence(id, {
              seed: pair.id,
              recipient: residentPubkey,
            });
            onOpen();
          }}
        >
          {pair.label}
        </button>
      ))}
      {query.data?.pages.some((page) => page.partial) ? (
        <p className="p-2 text-xs text-muted-foreground">
          Some history is unavailable under current permissions.
        </p>
      ) : null}
      {query.hasNextPage ? (
        <button
          type="button"
          className="px-3 py-2 text-sm"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Load older correspondence
        </button>
      ) : null}
    </section>
  );
}

/** The agent's existing page exposes its inbox without adding a global rail. */
export function AgentInboxMenu({ residentPubkey }: { residentPubkey: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="luca-mind-button" type="button">
          <Inbox aria-hidden /> Inbox
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 max-h-80 overflow-y-auto">
        {open ? (
          <InboxContents
            residentPubkey={residentPubkey}
            onOpen={() => setOpen(false)}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
