import { createFileRoute } from "@tanstack/react-router";

import { NewMessageScreen } from "@/features/messages/ui/NewMessageScreen";

export type NewMessageRouteSearch = {
  runtime?: string;
  skill?: string;
};

function boundedSearchString(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().slice(0, maxLength)
    : undefined;
}

export const Route = createFileRoute("/messages/new")({
  validateSearch: (search: Record<string, unknown>): NewMessageRouteSearch => ({
    runtime: boundedSearchString(search.runtime, 64),
    skill: boundedSearchString(search.skill, 160),
  }),
  component: NewMessageScreen,
});
