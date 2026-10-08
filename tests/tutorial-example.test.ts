import { describe,it,expect } from "vitest";
import { buildWelcomeSteps, EMPTY_JOURNEY } from "@/lib/tutorials/example-flow";
describe("原页面项目教程路线",()=>{
  it("从原有团队表单开始，所有项目步骤绑定同一个新建项目，没有独立练习页",()=>{
    const steps=buildWelcomeSteps({version:4,teamId:"demo-team",projectId:"demo-project",taskId:"first-task"});
    expect(steps[0].route).toBe("/settings/api");
    expect(steps).toHaveLength(19);expect(steps[1].route).toBe("/teams");
    expect(steps[2].route).toBe("/teams/demo-team/members");expect(steps[3].route).toBe("/teams/demo-team/projects");
    expect(steps.every(step=>!step.route.startsWith("/tutorials/example"))).toBe(true);
    expect(steps.slice(4,15).every(step=>step.route.startsWith("/projects/demo-project"))).toBe(true);
    expect(steps[9].route).toBe("/projects/demo-project/task-tree");expect(steps[9].target).toBe('[data-tour="tutorial-stage-task"]');
    expect(steps[10].completion).toBe("data-tour-claimed");expect(steps[11].completion).toBe("data-tour-submitted");
    expect(steps[11].route).toBe("/projects/demo-project?space=work&task=first-task");
    expect(steps[12].action).toBe("explore");expect(steps[13].action).toBe("explore");
  });
  it("初次启动无需已存在的项目与角色，第一步在原创建表单等待实际操作",()=>{
    const first=buildWelcomeSteps(EMPTY_JOURNEY)[0];
    expect(first.target).toBe('[data-tour="api-config"]');expect(first.action).toBe("result");
    expect(first.route).toBe("/settings/api");expect(new Set(buildWelcomeSteps(EMPTY_JOURNEY).map(step=>step.id)).size).toBe(19);
  });
});
