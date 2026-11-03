"use server";

/**
 * Phase 10 — "use server" wrappers around the archive service.
 *
 * Every wrapper resolves the actor from the SESSION (never from the
 * payload) via toAnalyticsActor, then delegates to the archive service
 * which re-validates role/tenant/state on its own. Only follow-up
 * archive/restore and the content restores (assignment / course /
 * program / assessment) are exposed — archiving for surveys keeps its
 * Phase 9 lifecycle action (terminal by design).
 */
import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/session";
import { toAnalyticsActor } from "@/lib/analytics/access";
import {
  archiveFollowUp,
  restoreAssessment,
  restoreAssignment,
  restoreCourse,
  restoreFollowUp,
  restoreProgram,
} from "@/lib/archive/service";

export interface ArchiveActionState {
  ok: boolean;
  message?: string;
  data?: { id?: string };
}

function stateFrom(result: { ok: boolean; message?: string; data?: { id: string } }): ArchiveActionState {
  if (result.ok) {
    revalidatePath("/archive");
    return { ok: true, data: { id: result.data?.id } };
  }
  return { ok: false, message: result.message };
}

async function actor() {
  const user = await getCurrentUser();
  return user ? toAnalyticsActor(user) : null;
}

export async function archiveFollowUpAction(
  _prev: ArchiveActionState,
  formData: FormData
): Promise<ArchiveActionState> {
  const current = await actor();
  if (!current) return { ok: false, message: "الجلسة منتهية — سجّل الدخول من جديد" };
  const followUpId = String(formData.get("followUpId") ?? "").trim();
  if (!followUpId) return { ok: false, message: "معرّف سجل المتابعة مفقود" };
  return stateFrom(await archiveFollowUp(current, followUpId));
}

export async function restoreFollowUpAction(
  _prev: ArchiveActionState,
  formData: FormData
): Promise<ArchiveActionState> {
  const current = await actor();
  if (!current) return { ok: false, message: "الجلسة منتهية — سجّل الدخول من جديد" };
  const followUpId = String(formData.get("followUpId") ?? "").trim();
  if (!followUpId) return { ok: false, message: "معرّف سجل المتابعة مفقود" };
  return stateFrom(await restoreFollowUp(current, followUpId));
}

export async function restoreAssignmentAction(
  _prev: ArchiveActionState,
  formData: FormData
): Promise<ArchiveActionState> {
  const current = await actor();
  if (!current) return { ok: false, message: "الجلسة منتهية — سجّل الدخول من جديد" };
  const assignmentId = String(formData.get("assignmentId") ?? "").trim();
  if (!assignmentId) return { ok: false, message: "معرّف التكليف مفقود" };
  return stateFrom(await restoreAssignment(current, assignmentId));
}

export async function restoreCourseAction(
  _prev: ArchiveActionState,
  formData: FormData
): Promise<ArchiveActionState> {
  const current = await actor();
  if (!current) return { ok: false, message: "الجلسة منتهية — سجّل الدخول من جديد" };
  const courseId = String(formData.get("courseId") ?? "").trim();
  if (!courseId) return { ok: false, message: "معرّف الدورة مفقود" };
  return stateFrom(await restoreCourse(current, courseId));
}

export async function restoreProgramAction(
  _prev: ArchiveActionState,
  formData: FormData
): Promise<ArchiveActionState> {
  const current = await actor();
  if (!current) return { ok: false, message: "الجلسة منتهية — سجّل الدخول من جديد" };
  const programId = String(formData.get("programId") ?? "").trim();
  if (!programId) return { ok: false, message: "معرّف البرنامج مفقود" };
  return stateFrom(await restoreProgram(current, programId));
}

export async function restoreAssessmentAction(
  _prev: ArchiveActionState,
  formData: FormData
): Promise<ArchiveActionState> {
  const current = await actor();
  if (!current) return { ok: false, message: "الجلسة منتهية — سجّل الدخول من جديد" };
  const assessmentId = String(formData.get("assessmentId") ?? "").trim();
  if (!assessmentId) return { ok: false, message: "معرّف التقييم مفقود" };
  return stateFrom(await restoreAssessment(current, assessmentId));
}