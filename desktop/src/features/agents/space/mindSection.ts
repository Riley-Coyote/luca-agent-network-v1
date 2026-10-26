/** The three tabs of a mind's space (Decided 2). */
export type MindSection = "notebook" | "self" | "settings";

/** Today's four values read onto the three tabs: place and notebook are the
 *  Notebook; documents is Self; settings is Settings. */
export function mindSectionOf(section: string | null | undefined): MindSection {
  if (section === "settings") return "settings";
  if (section === "self" || section === "documents" || section === "overview")
    return "self";
  return "notebook";
}
