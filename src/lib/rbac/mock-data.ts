import type { ProjectMember, User, Role } from "@/types/rbac";

export interface AgileSprint {
  id: string;
  projectId: string;
  name: string;
  status: "active" | "planned" | "closed";
  startDate: string;
  endDate: string;
  targetStoryPoints: number;
  completedStoryPoints: number;
}

export interface AgileTaskItem {
  id: string;
  projectId: string;
  sprintId: string;
  title: string;
  status: "todo" | "doing" | "review" | "done";
  priority: "high" | "medium" | "low";
  storyPoints: number;
  loggedHours: number;
  assignee?: User;
  deliverableUrl?: string;
}

export interface ProjectEvaluationRecord {
  id: string;
  projectId: string;
  milestoneTitle: string;
  score: number;
  grade: "A" | "B" | "C" | "D";
  evaluatorName: string;
  evaluatorRole: "teacher";
  comment: string;
  evaluatedAt: string;
}

export const MOCK_USERS: Record<string, User> = {
  u1: {
    id: "u-leader-01",
    name: "安和队长 (Alice)",
    email: "alice.leader@campus.edu",
    avatarUrl: "https://api.dicebear.com/7.x/bottts/svg?seed=Alice",
    kind: "human",
  },
  u2: {
    id: "u-member-01",
    name: "李组员 (Bob)",
    email: "bob.dev@campus.edu",
    avatarUrl: "https://api.dicebear.com/7.x/bottts/svg?seed=Bob",
    kind: "human",
  },
  u3: {
    id: "u-member-02",
    name: "张组员 (Charlie)",
    email: "charlie.qa@campus.edu",
    avatarUrl: "https://api.dicebear.com/7.x/bottts/svg?seed=Charlie",
    kind: "human",
  },
  u4: {
    id: "u-teacher-01",
    name: "王导师 (Prof. Wang)",
    email: "wang.prof@campus.edu",
    avatarUrl: "https://api.dicebear.com/7.x/bottts/svg?seed=ProfWang",
    kind: "human",
  },
  u5: {
    id: "u-agent-01",
    name: "Codex-AutoDev (AI)",
    email: "agent-codex@agents.local",
    kind: "agent",
  },
};

export const MOCK_PROJECT_MEMBERS: ProjectMember[] = [
  {
    id: "pm-01",
    projectId: "proj-agile-001",
    userId: MOCK_USERS.u1.id,
    user: MOCK_USERS.u1,
    role: "leader",
    joinedAt: "2026-09-01T08:00:00Z",
  },
  {
    id: "pm-02",
    projectId: "proj-agile-001",
    userId: MOCK_USERS.u2.id,
    user: MOCK_USERS.u2,
    role: "member",
    joinedAt: "2026-09-02T10:00:00Z",
  },
  {
    id: "pm-03",
    projectId: "proj-agile-001",
    userId: MOCK_USERS.u3.id,
    user: MOCK_USERS.u3,
    role: "member",
    joinedAt: "2026-09-03T11:30:00Z",
  },
  {
    id: "pm-04",
    projectId: "proj-agile-001",
    userId: MOCK_USERS.u4.id,
    user: MOCK_USERS.u4,
    role: "teacher",
    joinedAt: "2026-08-30T09:00:00Z",
  },
  {
    id: "pm-05",
    projectId: "proj-agile-001",
    userId: MOCK_USERS.u5.id,
    user: MOCK_USERS.u5,
    role: "member",
    joinedAt: "2026-09-10T14:00:00Z",
  },
];

export const MOCK_SPRINT: AgileSprint = {
  id: "sprint-2026-10",
  projectId: "proj-agile-001",
  name: "Sprint 3: 角色分工与权限控制落地",
  status: "active",
  startDate: "2026-10-01",
  endDate: "2026-10-14",
  targetStoryPoints: 34,
  completedStoryPoints: 21,
};

export const MOCK_EVALUATION: ProjectEvaluationRecord = {
  id: "eval-01",
  projectId: "proj-agile-001",
  milestoneTitle: "M1: 核心敏捷框架与自动化闭环验收",
  score: 95,
  grade: "A",
  evaluatorName: "王导师 (Prof. Wang)",
  evaluatorRole: "teacher",
  comment: "敏捷迭代推进严密，角色边界划分清晰，代码质量及交付物规范。",
  evaluatedAt: "2026-10-04T16:00:00Z",
};
