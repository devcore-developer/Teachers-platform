// ======================================================================
// src/app/actions/schools.ts  (معدّل — الملف كامل)
// ======================================================================
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createBranch,
  createSchool,
  setBranchActive,
  setSchoolActive,
  updateBranch,
  updateSchool,
  type SchoolWithBranchCount,
} from "@/lib/schools/service";
import { deleteSchool, type SchoolDeletionSummary } from "@/lib/schools/delete";
import type { ServiceResult } from "@/lib/validation/schools";

/* ------------------------------------------------------------------ */
/* Server actions for the school management module.                    */
/*                                                                     */
/* Thin, non-testable wrappers around src/lib/schools/service.ts:      */
/* they add cache invalidation only. ALL validation, authorization     */
/* (dev admin today) and tenant-ownership checks live in the service   */
/* layer and run on the server for every call.                         */
/* ------------------------------------------------------------------ */

function revalidateSchoolPaths(schoolId?: string) {
  revalidatePath("/");
  revalidatePath("/schools");
  if (schoolId) revalidatePath(`/schools/${schoolId}`);
}

export type SchoolFormState = ServiceResult<SchoolWithBranchCount> | { ok: false } | null;

export async function createSchoolAction(
  _prevState: SchoolFormState,
  formData: FormData
): Promise<SchoolFormState> {
  const payload = {
    nameAr: String(formData.get("nameAr") ?? ""),
    nameEn: String(formData.get("nameEn") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    logoUrl: String(formData.get("logoUrl") ?? ""),
    brandColor: String(formData.get("brandColor") ?? ""),
    isActive: formData.get("isActive") === "on",
  };

  const result = await createSchool(payload);
  if (result.ok) {
    revalidateSchoolPaths(result.data.id);
    redirect(`/schools/${result.data.id}`);
  }
  return result;
}

export async function updateSchoolAction(
  _prevState: SchoolFormState,
  formData: FormData
): Promise<SchoolFormState> {
  const payload = {
    id: String(formData.get("id") ?? ""),
    nameAr: String(formData.get("nameAr") ?? ""),
    nameEn: String(formData.get("nameEn") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    logoUrl: String(formData.get("logoUrl") ?? ""),
    brandColor: String(formData.get("brandColor") ?? ""),
  };

  const result = await updateSchool(payload);
  if (result.ok) revalidateSchoolPaths(result.data.id);
  return result;
}

/**
 * Activate/deactivate a school — the non-destructive alternative to
 * deleteSchoolAction below (deactivation preserves history).
 */
export async function setSchoolActiveAction(
  schoolId: string,
  isActive: boolean
): Promise<ServiceResult<SchoolWithBranchCount>> {
  const result = await setSchoolActive(schoolId, isActive);
  if (result.ok) revalidateSchoolPaths(schoolId);
  return result;
}

/**
 * PERMANENTLY delete ONE school with ALL of its dependent data —
 * SUPER_ADMIN only, enforced again inside the service on every call
 * (the typed school name in the dialog is a client-side safeguard only).
 *
 * The deletion itself runs in a single transaction inside
 * src/lib/schools/delete.ts; this wrapper only adds cache invalidation
 * (the school detail page 404s naturally after refresh).
 */
export async function deleteSchoolAction(
  schoolId: string
): Promise<ServiceResult<SchoolDeletionSummary>> {
  const result = await deleteSchool(schoolId);
  if (result.ok) revalidateSchoolPaths(schoolId);
  return result;
}

/* ----------------------------- Branches --------------------------- */

export type BranchMutationState = ServiceResult<unknown> | null;

export async function createBranchAction(
  schoolId: string,
  formData: FormData
): Promise<BranchMutationState> {
  const payload = {
    schoolId,
    nameAr: String(formData.get("nameAr") ?? ""),
    nameEn: String(formData.get("nameEn") ?? ""),
    stage: String(formData.get("stage") ?? ""),
    isActive: formData.get("isActive") === "on",
  };

  const result = await createBranch(payload);
  if (result.ok) revalidateSchoolPaths(schoolId);
  return result;
}

export async function updateBranchAction(
  schoolId: string,
  formData: FormData
): Promise<BranchMutationState> {
  const payload = {
    schoolId,
    branchId: String(formData.get("branchId") ?? ""),
    nameAr: String(formData.get("nameAr") ?? ""),
    nameEn: String(formData.get("nameEn") ?? ""),
    stage: String(formData.get("stage") ?? ""),
  };

  const result = await updateBranch(payload);
  if (result.ok) revalidateSchoolPaths(schoolId);
  return result;
}

export async function setBranchActiveAction(
  schoolId: string,
  branchId: string,
  isActive: boolean
): Promise<BranchMutationState> {
  const result = await setBranchActive(schoolId, branchId, isActive);
  if (result.ok) revalidateSchoolPaths(schoolId);
  return result;
}