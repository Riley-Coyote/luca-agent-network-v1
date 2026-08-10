import { ArrowRight, LoaderCircle } from "lucide-react";

import type { DirectRuntimeContactOption } from "@/features/messages/lib/directRuntimeContacts";

export function DirectRuntimeContactRow({
  contact,
  isPending,
  onSelect,
}: {
  contact: DirectRuntimeContactOption;
  isPending: boolean;
  onSelect: (contact: DirectRuntimeContactOption) => void;
}) {
  const isReady = contact.readiness === "ready";
  const status = isPending
    ? "Creating resident…"
    : isReady
      ? "Ready · identity created on first message"
      : "Setup required";

  return (
    <button
      aria-label={
        isReady
          ? `Message ${contact.displayName}`
          : `Set up ${contact.displayName}`
      }
      className="group/runtime flex min-h-14 w-full items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150 ease-out hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
      data-testid={`direct-runtime-contact-${contact.runtimeId}`}
      disabled={isPending}
      onClick={() => onSelect(contact)}
      type="button"
    >
      <span className="flex size-8 shrink-0 items-center justify-center">
        <img
          alt=""
          aria-hidden="true"
          className="size-7 rounded-[5px] object-cover"
          data-testid={`direct-runtime-contact-icon-${contact.runtimeId}`}
          src={contact.iconUrl}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium tracking-tight text-foreground">
          {contact.displayName}
        </span>
        <span
          className="mt-0.5 block truncate text-xs text-muted-foreground"
          data-testid={`direct-runtime-contact-status-${contact.runtimeId}`}
        >
          {status}
        </span>
      </span>
      {isPending ? (
        <LoaderCircle
          aria-hidden="true"
          className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
        />
      ) : (
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors group-hover/runtime:text-foreground group-focus-visible/runtime:text-foreground">
          {isReady ? "Message" : "Set up"}
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </span>
      )}
    </button>
  );
}
