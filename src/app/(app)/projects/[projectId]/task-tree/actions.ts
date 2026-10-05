"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { AppError, ForbiddenError } from "@/lib/errors";
import {
  generateTaskTreeDraft,
  publishTaskTreeDraft,
  rejectTaskTreeDraft,
  reviewStageIntegration,
  submitStageIntegration,
  submitTaskDelivery,
} from "@/lib/task-tree";

export type TreeActionState = { error?: string; success?: string } | null;

function message(error: unknown) {
  if (error instanceof ForbiddenError) return "没有权限执行此操作";
  if (error instanceof AppError) return error.message;
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? "任务树格式无效";
  throw error;
}

export async function submitDeliveryAction(_state: TreeActionState, formData: FormData): Promise<TreeActionState> {
  const projectId = String(formData.get("projectId") ?? "");
  const taskId = String(formData.get("taskId") ?? "");
  try {
    await submitTaskDelivery(await actor(), taskId, {
      branchName: String(formData.get("branchName") ?? ""),
      headSha: String(formData.get("headSha") ?? ""),
      pullRequestUrl: String(formData.get("pullRequestUrl") ?? ""),
      testSummary: String(formData.get("testSummary") ?? ""),
    });
    revalidatePath(`/projects/${projectId}/task-tree`);
    return { success: "交付分支已登记" };
  } catch (error) {
    return { error: message(error) };
  }
}

async function actor() {
  const session = await auth();
  if (!session?.user) throw new ForbiddenError("请先登录");
  return session.user.id;
}

export async function generateTreeAction(_state: TreeActionState, formData: FormData): Promise<TreeActionState> {
  const projectId = String(formData.get("projectId") ?? "");
  const content = String(formData.get("content") ?? "");
  if (!z.uuid().safeParse(projectId).success) return { error: "项目参数无效" };
  try {
    await generateTaskTreeDraft(await actor(), projectId, content);
    revalidatePath(`/projects/${projectId}/task-tree`);
    return { success: "草案已生成，请确认后发布" };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function resolveDraftAction(_state: TreeActionState, formData: FormData): Promise<TreeActionState> {
  const projectId = String(formData.get("projectId") ?? "");
  const draftId = String(formData.get("draftId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(draftId).success) return { error: "参数无效" };
  try {
    if (decision === "publish") await publishTaskTreeDraft(await actor(), draftId);
    else if (decision === "reject") await rejectTaskTreeDraft(await actor(), draftId);
    else return { error: "操作无效" };
    revalidatePath(`/projects/${projectId}/task-tree`);
    revalidatePath(`/projects/${projectId}`);
    return { success: decision === "publish" ? "任务树已发布" : "草案已撤销" };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function submitIntegrationAction(_state: TreeActionState, formData: FormData): Promise<TreeActionState> {
  const projectId = String(formData.get("projectId") ?? "");
  const stageId = String(formData.get("stageId") ?? "");
  try {
    await submitStageIntegration(await actor(), stageId, {
      branchName: String(formData.get("branchName") ?? ""),
      headSha: String(formData.get("headSha") ?? ""),
      testSummary: String(formData.get("testSummary") ?? ""),
    });
    revalidatePath(`/projects/${projectId}/task-tree`);
    return { success: "已提交阶段集成审核" };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function reviewIntegrationAction(_state: TreeActionState, formData: FormData): Promise<TreeActionState> {
  const projectId = String(formData.get("projectId") ?? "");
  const integrationId = String(formData.get("integrationId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  try {
    if (decision !== "accept" && decision !== "reject") return { error: "操作无效" };
    await reviewStageIntegration(await actor(), integrationId, {
      decision,
      note: String(formData.get("note") ?? ""),
    });
    revalidatePath(`/projects/${projectId}/task-tree`);
    revalidatePath(`/projects/${projectId}`);
    return { success: decision === "accept" ? "集成审核通过，下一阶段已解锁" : "已退回重新集成" };
  } catch (error) {
    return { error: message(error) };
  }
}
