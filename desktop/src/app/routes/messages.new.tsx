import { createFileRoute } from "@tanstack/react-router";

import { NewMessageScreen } from "@/features/messages/ui/NewMessageScreen";

type NewMessageRouteSearch = {
  projectId?: string;
  collection?: "agent" | "project";
  collectionId?: string;
};

export const Route = createFileRoute("/messages/new")({
  validateSearch: (search: Record<string, unknown>): NewMessageRouteSearch => ({
    projectId:
      typeof search.projectId === "string" ? search.projectId : undefined,
    collection:
      search.collection === "agent" || search.collection === "project"
        ? search.collection
        : undefined,
    collectionId:
      typeof search.collectionId === "string" ? search.collectionId : undefined,
  }),
  component: NewMessageRouteComponent,
});

function NewMessageRouteComponent() {
  const search = Route.useSearch();
  return <NewMessageScreen {...search} />;
}
