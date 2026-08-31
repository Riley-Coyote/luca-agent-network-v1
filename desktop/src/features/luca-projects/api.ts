import { invokeTauri } from "@/shared/api/tauri";

export type LucaProject = {
  id: string;
  name: string;
  archived: boolean;
  instructions: string | null;
  workingFolder: string | null;
  workingFolderState: "not_set" | "connected" | "missing";
  contextRevision: number;
};

export type CreateLucaProjectInput = {
  name: string;
  instructions?: string;
  workingFolder?: string;
};

export type UpdateLucaProjectInput = {
  projectId: string;
  name?: string;
  archived?: boolean;
  instructions?: string | null;
  workingFolder?: string | null;
};

export function listLucaProjects(): Promise<LucaProject[]> {
  return invokeTauri<LucaProject[]>("list_luca_projects");
}

export function createLucaProject(
  input: CreateLucaProjectInput,
): Promise<LucaProject> {
  return invokeTauri<LucaProject>("create_luca_project", { input });
}

export function updateLucaProject(
  input: UpdateLucaProjectInput,
): Promise<LucaProject> {
  return invokeTauri<LucaProject>("update_luca_project", { input });
}
