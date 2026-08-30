import type { Artifact, SyncSnapshot, WorkItem } from "@dongo/contracts";

export interface ExportArtifact {
  kind?: Artifact["kind"] | string;
  label?: string;
  type?: string;
  title?: string;
  url?: string;
  repositoryPath?: string;
}

export interface ExportWorkItem {
  id?: WorkItem["id"] | string;
  identifier: WorkItem["identifier"];
  title: WorkItem["title"];
  state?: WorkItem["state"] | string;
  status?: string;
  description?: string;
  goal?: WorkItem["goal"];
  outcome?: WorkItem["outcome"];
  sourceIntake?: string;
  sourceIntakeIds?: readonly string[];
  notes?: string;
  conversation?: readonly { actor?: { displayName?: string }; body: string }[];
  createdAt?: WorkItem["createdAt"] | string;
  completedAt?: WorkItem["completedAt"] | string;
  artifacts?: readonly ExportArtifact[];
}

export interface ExportSnapshot {
  project?: SyncSnapshot["project"];
  workItems: readonly ExportWorkItem[];
}

export interface ManagedFile {
  path: string;
  sha256: string;
}

export interface ExportManifest {
  schemaVersion: 1;
  files: ManagedFile[];
}

export interface ExportResult {
  root: string;
  files: ManagedFile[];
  removed: string[];
}
