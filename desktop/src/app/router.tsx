import { createHashHistory, createRouter } from "@tanstack/react-router";

import { routeTree } from "@/app/routeTree.gen";
import { wireNavigationChoreography } from "@/app/navigationChoreography";

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  scrollRestoration: true,
  getScrollRestorationKey: (location: { pathname: string }) =>
    location.pathname,
  // Route changes ride the View Transitions API where the webview has it
  // (the router no-ops elsewhere). The choreography — which direction the
  // content plane drifts, when the dissolve runs — is stamped by
  // `navigationChoreography.ts` and obeyed in navigation-transitions.css.
  defaultViewTransition: true,
});

wireNavigationChoreography(router);

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
