import { AsyncLocalStorage } from "node:async_hooks";

export type ProjectOperationContext = {
  projectId: string;
  operatorId: string;
  actingAsId: string;
  actingAsName: string;
  role: string;
  recorded: boolean;
};
export const projectOperationContext = new AsyncLocalStorage<ProjectOperationContext>();
