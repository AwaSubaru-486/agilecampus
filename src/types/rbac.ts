/**
 * 敏捷开发团队 RBAC 角色与权限核心类型定义
 */

/**
 * 系统支持的三类核心敏捷角色
 * - leader: 组长（全面负责任务编排、Sprint 敏捷迭代与成员任务分配）
 * - member: 组员（负责任务认领、工时与状态推进、交付成果提交）
 * - teacher: 老师/导师（全局只读/评估视图、里程碑审批、打分评价，不可直接改日常敏捷卡片）
 */
export type Role = "leader" | "member" | "teacher";

/**
 * 细粒度操作权限编码 (Action Permissions)
 */
export type Permission =
  // ── 看板与敏捷视图 (Board & Agile Views) ──
  | "project:view"               // 查看项目与基础信息
  | "board:view"                 // 查看敏捷看板
  | "sprint:view"                // 查看迭代列表与任务卡片
  | "burndown:view"              // 查看燃尽图与效率分析
  | "sprint_log:view"            // 查看敏捷迭代日志
  | "evaluation:view"            // 查看评审与评估结果

  // ── 任务操作 (Task Operations) ──
  | "task:create"                // 创建任务卡片 (Backlog / Sprint Task)
  | "task:decompose"             // 拆分子任务
  | "task:assign"                // 分配任务负责人
  | "task:prioritize"            // 调整任务优先级与排序
  | "task:delete"                // 删除任务卡片
  | "task:claim"                 // 认领任务
  | "task:update_self"           // 更新自己负责任务的状态
  | "task:log_hours"             // 记录任务实际工时
  | "task:update_status"         // 任意修改日常敏捷卡片状态（组员推进 / 组长调整；教师禁用）

  // ── 成果物与证据 (Deliverables & Evidence) ──
  | "evidence:submit"            // 提交代码分支/PR/交付成果物关联记录
  | "deliverable:create"         // 创建项目阶段产物登记

  // ── 迭代管理 (Sprint Management) ──
  | "sprint:manage"              // 敏捷迭代配置
  | "sprint:start"               // 开启新 Sprint
  | "sprint:close"               // 关闭/完成当前 Sprint

  // ── 成员与角色管理 (Member & Role Management) ──
  | "member:view"                // 查看项目成员列表
  | "member:manage_roles"        // 调整本组成员项目角色与权限

  // ── 导师评审与评估 (Teacher Supervision & Evaluation) ──
  | "milestone:approve"          // 审批关键里程碑
  | "evaluation:comment"         // 发布评语反馈
  | "evaluation:grade"           // 项目成果打分与评级
  | "report:export";             // 导出敏捷统计与质量分析报告

/**
 * 角色元数据定义
 */
export interface RoleDefinition {
  id: Role;
  name: string;
  description: string;
  badgeTone: "signal" | "agent" | "human" | "neutral";
  isRestrictedAgileCardModifier?: boolean; // 是否禁止直接修改日常卡片
}

/**
 * 用户模型
 */
export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  kind?: "human" | "agent";
}

/**
 * 项目成员关联模型 (Project Member with Role)
 */
export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  user: User;
  role: Role;
  joinedAt: string;
}

/**
 * 角色与权限映射矩阵 (Role-Permission Matrix)
 */
export const ROLE_PERMISSIONS_MAP: Record<Role, readonly Permission[]> = {
  // 1. 组员 (Member): 看板查看、认领自己任务、报工时、交成果
  member: [
    "project:view",
    "board:view",
    "sprint:view",
    "task:claim",
    "task:update_self",
    "task:log_hours",
    "task:update_status",
    "evidence:submit",
    "deliverable:create",
    "member:view",
  ],

  // 2. 组长 (Leader): 继承组员全部权限 + 任务拆分分配 + Sprint 迭代启闭 + 优先级调度 + 角色分配
  leader: [
    // 继承组员全部权限
    "project:view",
    "board:view",
    "sprint:view",
    "task:claim",
    "task:update_self",
    "task:log_hours",
    "task:update_status",
    "evidence:submit",
    "deliverable:create",
    "member:view",

    // 组长特权
    "burndown:view",
    "sprint_log:view",
    "task:create",
    "task:decompose",
    "task:assign",
    "task:prioritize",
    "task:delete",
    "sprint:manage",
    "sprint:start",
    "sprint:close",
    "member:manage_roles",
    "evaluation:view",
  ],

  // 3. 老师/导师 (Teacher): 全局只读评估、燃尽图、迭代日志、审批里程碑、评语打分、导出报表；
  // 严格限制：不可直接修改日常敏捷卡片（无 task:update_status / task:claim / task:create）
  teacher: [
    "project:view",
    "board:view",
    "sprint:view",
    "burndown:view",
    "sprint_log:view",
    "evaluation:view",
    "member:view",
    "milestone:approve",
    "evaluation:comment",
    "evaluation:grade",
    "report:export",
  ],
};

/**
 * 角色显示信息列表
 */
export const ROLE_DEFINITIONS: Record<Role, RoleDefinition> = {
  leader: {
    id: "leader",
    name: "组长 (Leader)",
    description: "全面负责敏捷任务编排、Sprint 开启与关闭、成员任务分配与优先级管理。",
    badgeTone: "signal",
  },
  member: {
    id: "member",
    name: "组员 (Member)",
    description: "日常开发主体，负责任务认领、推进状态、填报工时与提交交付成果关联物。",
    badgeTone: "human",
  },
  teacher: {
    id: "teacher",
    name: "导师 (Supervisor)",
    description: "全局评审视界，把控里程碑与打分评估，不可直接修改日常敏捷卡片状态以保障开发独立性。",
    badgeTone: "agent",
    isRestrictedAgileCardModifier: true,
  },
};
