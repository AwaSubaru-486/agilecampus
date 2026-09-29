import type { ProjectSnapshot } from "../types";

export class AgileCampusApiClient {
  constructor(private readonly baseUrl: string) {}

  /**
   * The first extension slice only carries the typed boundary. Authentication
   * and project mapping are added after the webview can render its empty states.
   */
  async getSnapshot(): Promise<ProjectSnapshot> {
    return {
      projectName: "尚未关联 AgileCampus 项目",
      projectId: null,
      repository: null,
      currentBranch: null,
      myTasks: [],
      blockers: [],
    };
  }

  webUrl(path = "/projects"): string {
    return new URL(path, this.baseUrl).toString();
  }
}
