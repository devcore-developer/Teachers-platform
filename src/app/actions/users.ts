"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { requireAdminContext } from "@/lib/auth/dev-admin";
import { requireUser } from "@/lib/auth/session";
import {
  assignTeacherSupervisor,
  createStaffAccount,
  removeTeacherSupervisor,
  setDeputyScope,
  setSupervisorBranches,
  updateUserProfileByAdmin,
  updateOwnProfile,
} from "@/lib/users/directory";
import { setAccountActive } from "@/lib/users/service";

/* ------------------------------------------------------------------ */
/* Phase 4 server actions — thin wrappers. Every authorization rule     */
/* lives in the service layer (src/lib/users/directory.ts + service.ts);*/
/* these functions only extract input, call the service and refresh the */
/* affected pages. Nothing security-relevant happens on the client.     */
/* ------------------------------------------------------------------ */

export interface UserFormState {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  emailSent?: boolean;
}

/** Derive the absolute app base URL from request headers. */
async function appBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

function refreshUserPaths(userId?: string) {
  revalidatePath("/users");
  revalidatePath("/");
  if (userId) revalidatePath(`/users/${userId}`);
}

/**
 * Select placeholders submit the sentinel "none" — map it to empty so
 * the optional-field validation treats it as "not chosen".
 */
function formValue(formData: FormData, key: string): string {
  const raw = String(formData.get(key) ?? "");
  return raw === "none" ? "" : raw;
}

/* ------------------------ Staff account creation ------------------- */

export async function createStaffAccountAction(
  _prevState: UserFormState | null,
  formData: FormData
): Promise<UserFormState> {
  const ctx = await requireAdminContext();

  const result = await createStaffAccount(
    {
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      role: String(formData.get("role") ?? ""),
      branchId: formValue(formData, "branchId"),
      schoolId: formValue(formData, "schoolId"),
    },
    ctx,
    { appBaseUrl: await appBaseUrl() }
  );

  if (result.ok) {
    refreshUserPaths(result.data.id);
    return {
      ok: true,
      emailSent: result.data.emailSent,
      message: result.data.emailSent
        ? `تم إنشاء حساب ${result.data.name} — أُرسل رابط تأكيد البريد إلى ${result.data.email}`
        : `تم إنشاء حساب ${result.data.name}، لكن تعذر إرسال بريد التأكيد الآن — شارك رابط التحقق لاحقًا أو أعد الإرسال عند توفر المزود`,
    };
  }

  return {
    ok: false,
    message: result.message,
    fieldErrors: result.fieldErrors,
  };
}

/* --------------------------- Status toggle ------------------------- */

export async function setUserActiveAction(
  userId: string,
  isActive: boolean
): Promise<UserFormState> {
  const ctx = await requireAdminContext();

  const result = await setAccountActive(userId, isActive, ctx);
  if (result.ok) refreshUserPaths(userId);

  return {
    ok: result.ok,
    message: result.ok
      ? isActive
        ? "تم تفعيل الحساب"
        : "تم إيقاف الحساب وإنهاء جلساته النشطة"
      : result.message,
  };
}

/* --------------------------- Profile edits ------------------------- */

export async function updateUserProfileByAdminAction(
  _prevState: UserFormState | null,
  formData: FormData
): Promise<UserFormState> {
  const ctx = await requireAdminContext();

  const result = await updateUserProfileByAdmin(
    {
      userId: String(formData.get("userId") ?? ""),
      name: String(formData.get("name") ?? ""),
      branchId: formValue(formData, "branchId"),
    },
    ctx
  );

  if (result.ok) refreshUserPaths(result.data.id);
  return {
    ok: result.ok,
    message: result.ok ? "تم حفظ بيانات الحساب" : result.message,
    fieldErrors: result.ok ? undefined : result.fieldErrors,
  };
}

export async function updateOwnProfileAction(
  _prevState: UserFormState | null,
  formData: FormData
): Promise<UserFormState> {
  const user = await requireUser();

  const result = await updateOwnProfile(
    { name: String(formData.get("name") ?? "") },
    user.id
  );

  if (result.ok) {
    revalidatePath("/my-profile");
    revalidatePath("/");
  }
  return {
    ok: result.ok,
    message: result.ok ? "تم تحديث الاسم" : result.message,
    fieldErrors: result.ok ? undefined : result.fieldErrors,
  };
}

/* --------------------- Supervisor scope + teachers ----------------- */

export async function setSupervisorBranchesAction(
  supervisorId: string,
  branchIds: string[]
): Promise<UserFormState> {
  const ctx = await requireAdminContext();

  const result = await setSupervisorBranches({ supervisorId, branchIds }, ctx);
  if (result.ok) refreshUserPaths(supervisorId);
  return {
    ok: result.ok,
    message: result.ok ? "تم تحديث نطاق فروع المشرف" : result.message,
  };
}

export async function assignTeacherSupervisorAction(
  _prevState: UserFormState | null,
  formData: FormData
): Promise<UserFormState> {
  const ctx = await requireAdminContext();

  const result = await assignTeacherSupervisor(
    {
      teacherId: String(formData.get("teacherId") ?? ""),
      supervisorId: String(formData.get("supervisorId") ?? ""),
    },
    ctx
  );

  if (result.ok) refreshUserPaths(result.data.teacherId);
  return {
    ok: result.ok,
    message: result.ok ? "تم إسناد المعلم إلى المشرف" : result.message,
    fieldErrors: result.ok ? undefined : result.fieldErrors,
  };
}

export async function removeTeacherSupervisorAction(
  teacherId: string
): Promise<UserFormState> {
  const ctx = await requireAdminContext();

  const result = await removeTeacherSupervisor({ teacherId }, ctx);
  if (result.ok) refreshUserPaths(teacherId);
  return {
    ok: result.ok,
    message: result.ok ? "تم إلغاء إسناد المشرف" : result.message,
  };
}

/* ------------------------------ Deputy ----------------------------- */

export async function setDeputyScopeAction(
  deputyId: string,
  mode: "school" | "branches",
  branchIds: string[]
): Promise<UserFormState> {
  const ctx = await requireAdminContext();

  const result = await setDeputyScope({ deputyId, mode, branchIds }, ctx);
  if (result.ok) refreshUserPaths(deputyId);
  return {
    ok: result.ok,
    message: result.ok ? "تم تحديث نطاق اطلاع الوكيل" : result.message,
  };
}