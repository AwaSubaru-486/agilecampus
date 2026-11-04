import type { TaskStatus } from "./task-status";

export const ITERATION_STATUSES = ["planned", "active", "released"] as const;
export type IterationStatus = (typeof ITERATION_STATUSES)[number];
export const ITERATION_LABELS: Record<IterationStatus, string> = {
  planned: "计划中", active: "进行中", released: "已发布",
};
export type IterationTask = { id: string; title: string; status: TaskStatus; assigneeName: string | null };
export const FEATURE_CHANGES = ["added", "improved", "fixed"] as const;
export type FeatureChange = (typeof FEATURE_CHANGES)[number];
export const FEATURE_CHANGE_LABELS: Record<FeatureChange, string> = { added: "新增", improved: "完善", fixed: "修复" };
export type IterationFeature = { id: string; name: string; summary: string; change: FeatureChange };
export type IterationModule = { id: string; name: string; summary: string; resultUrl: string; context: string };
export type IterationView = {
  id: string; version: string; title: string; goal: string; releaseNotes: string;
  startDate: string | null; endDate: string | null; status: IterationStatus;
  releasedAt: string | null; createdAt: string; updatedAt: string;
  baseIterationId: string | null; features: IterationFeature[];
  executionNotes: string; validationNotes: string; releaseUrl: string;
  moduleSnapshot: IterationModule[] | null;
};
