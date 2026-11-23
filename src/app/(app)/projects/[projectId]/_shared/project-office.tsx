import { getHomeView } from "@/lib/home";
import { HomeSpace } from "../../../home/home-space";
import { MemberBoard } from "./member-board";
import { getTaskTree } from "@/lib/task-tree";
import { summarizeOfficeTasks } from "@/lib/office-task-summary";

export async function ProjectOffice({ actorId, viewUserId, projectId, teamId, name, canAct }: {
  actorId: string; viewUserId: string; projectId: string; teamId: string; name: string; canAct: boolean;
}) {
  const [data, tree] = await Promise.all([getHomeView(actorId, { view: "courtyard", team: teamId, projectId }), getTaskTree(actorId, projectId)]);
  return <HomeSpace key={projectId} data={data} project={{ id: projectId, name, canAct }} taskSummary={summarizeOfficeTasks(tree.tasks, viewUserId)} taskBoard={<MemberBoard actorId={actorId} viewUserId={viewUserId} projectId={projectId} taskTree={tree} embedded />} />;
}
