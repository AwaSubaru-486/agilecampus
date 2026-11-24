import { getHomeView } from "@/lib/home";
import { listProjectBlockers } from "@/lib/blocker";
import { HomeSpace } from "../../../home/home-space";
import { MemberBoard } from "./member-board";
import { getTaskTree } from "@/lib/task-tree";
import { summarizeOfficeTasks } from "@/lib/office-task-summary";

export async function ProjectOffice({ actorId, viewUserId, projectId, teamId, name, canAct }: {
  actorId: string; viewUserId: string; projectId: string; teamId: string; name: string; canAct: boolean;
}) {
  const [data, tree, openBlockers] = await Promise.all([
    getHomeView(actorId, { view: "courtyard", team: teamId, projectId }),
    getTaskTree(actorId, projectId),
    listProjectBlockers(actorId, projectId, { status: ["open"] }),
  ]);
  const blockedTaskIds = new Set(openBlockers.map(blocker => blocker.taskId));
  const blockedMemberIds = new Set<string>();
  for (const task of tree.tasks) {
    if (task.assigneeId && !task.isTaskGroup && task.status !== "done" && blockedTaskIds.has(task.id)) {
      blockedMemberIds.add(task.assigneeId);
    }
  }

  return <HomeSpace
    key={projectId}
    data={data}
    project={{ id: projectId, name, canAct }}
    blockedMemberIds={[...blockedMemberIds]}
    taskSummary={summarizeOfficeTasks(tree.tasks, viewUserId)}
    taskBoard={<MemberBoard actorId={actorId} viewUserId={viewUserId} projectId={projectId} taskTree={tree} openBlockers={openBlockers} embedded />}
  />;
}
