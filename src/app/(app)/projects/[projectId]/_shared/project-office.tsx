import { getHomeView } from "@/lib/home";
import { HomeSpace } from "../../../home/home-space";
import { MemberBoard } from "./member-board";

export async function ProjectOffice({ actorId, viewUserId, projectId, teamId, name, canAct }: {
  actorId: string; viewUserId: string; projectId: string; teamId: string; name: string; canAct: boolean;
}) {
  const data = await getHomeView(actorId, { view: "courtyard", team: teamId, projectId });
  return <HomeSpace key={projectId} data={data} project={{ id: projectId, name, canAct }} taskBoard={<MemberBoard actorId={actorId} viewUserId={viewUserId} projectId={projectId} embedded />} />;
}
