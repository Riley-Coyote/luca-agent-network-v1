# The loading language

The rule: **nothing blocks silently.** Any wait that can exceed ~250ms
shows a branded busy state; any wait that can exceed a few seconds must be
backgroundable, with a persistent indicator somewhere the owner can see.

## The vocabulary

| Piece | What it is | When to use it |
| --- | --- | --- |
| `BusyMark` (`shared/ui/BusyMark.tsx`) | The house busy mark — a dot-matrix panel running the `work` scene. Same fixed seed everywhere, so it is one recognizable mark, not a family of spinners. | Surface-level waits: panels, cards, background tasks. |
| `Spinner` (`shared/ui/spinner.tsx`) | The small arc spinner. | Micro-waits inside buttons and inline affordances only. |
| `SkeletonReveal` (`shared/ui/skeleton.tsx`) | Skeleton that blur-crossfades into the real content when loading flips false. | Page/panel first loads. |
| Lucide `animate-spin` | Legacy. | Never in new code; convert opportunistically. |

All of these are reduced-motion-safe: the dot engine settles to a static
frame, the spinner's keyframes are guarded, `SkeletonReveal` falls back to
a plain swap.

## Background tasks

`shared/lib/backgroundTasks.ts` is the store behind the rule. An operation
that can outlive its surface registers its promise:

```ts
startBackgroundTask("Connecting Files", promise, readableError);
```

The store owns the settle — completion lands even if the view that started
the task unmounts. The sidebar footer renders one card
(`SidebarBackgroundTaskCard`) narrating the store: BusyMark while running,
brief success that dismisses itself, failure that holds until dismissed.
The store resets on community switch (`resetCommunityState`).

First adopter: Brain source connect. Consent → the dialog leaves
immediately, the connect runs in the background, the footer narrates it.

## Adding a wait

1. Can it exceed a few seconds? Register a background task and let the
   footer narrate it. Do not hold a modal open.
2. Is it a panel or page load? `SkeletonReveal` with a light skeleton.
3. Is it a button doing work? `Spinner` inside the button.
4. Anything else briefly busy? `BusyMark`.
