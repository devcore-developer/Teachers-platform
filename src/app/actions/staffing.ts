"use server";

/**
 * Batch 2 — Excel/CSV import actions for teacher-supervisor assignments
 * and teacher data (HTML v21/v26). The file is parsed and validated
 * SERVER-SIDE; the client only ever sees the serializable preview.
 */
import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/session";
import {
  commitImport,
  previewImport,
  type CommitOptions,
  type ImportActor,
  type ImportPreview,
} from "@/lib/staffing/import";

export interface ImportActionState {
  ok: boolean;
  message?: string;
  code?: string;
  /** The validated preview (client renders it, then commits the same file). */
  preview?: ImportPreview;
  commit?: {
    applied: number;
    skipped: number;
    createdAccounts: number;
    notes: string[];
  };
}

function failure(message: string, code?: string): ImportActionState {
  return { ok: false, message, code };
}

async function actor(): Promise<ImportActor | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return { id: user.id, role: user.role, schoolId: user.schoolId };
}

/** Read the uploaded file as UTF-8 text (accepts .csv — Excel-compatible). */
async function readCsvFile(file: FormDataEntryValue | null): Promise<string | null> {
  if (!file || typeof file === "string") return null;
  const blob = file as File;
  if (blob.size <= 0 || blob.size > 2 * 1024 * 1024) return null;
  const text = await blob.text();
  return text.length > 0 ? text : null;
}

export async function previewImportAction(
  _prev: ImportActionState,
  formData: FormData
): Promise<ImportActionState> {
  try {
    const context = await actor();
    if (!context) return failure("يجب تسجيل الدخول أولًا", "FORBIDDEN");
    const csvText = await readCsvFile(formData.get("file"));
    if (csvText === null) {
      return failure(
        "اختر ملف CSV صالحًا (حتى 2MB) — يفتح ويُحفظ من Excel مباشرة",
        "VALIDATION_ERROR"
      );
    }
    const result = await previewImport(context, csvText);
    if (!result.ok) return failure(result.message, result.code);
    return {
      ok: true,
      message: `تمت قراءة ${result.data.total} سجلًا — راجع الإسناد ثم اضغط «اعتماد الإسناد».`,
      preview: result.data,
    };
  } catch {
    return failure("تعذر قراءة الملف — تأكد أنه CSV صحيح وأن الصف الأول أسماء الأعمدة", "UNKNOWN");
  }
}

/**
 * Commit the import. The server re-parses and re-validates the SAME
 * file contents (posted as `csvText`) — a stale or tampered client
 * cannot inject rows that were never validated.
 */
export async function commitImportAction(
  _prev: ImportActionState,
  formData: FormData
): Promise<ImportActionState> {
  try {
    const context = await actor();
    if (!context) return failure("يجب تسجيل الدخول أولًا", "FORBIDDEN");
    const csvText = String(formData.get("csvText") ?? "");
    if (!csvText.trim()) return failure("لا توجد بيانات معتمدة — اختر الملف أولًا", "VALIDATION_ERROR");
    const options: CommitOptions = {
      createMissingAccounts: formData.get("createMissingAccounts") === "on",
      updateSchool: formData.get("updateSchool") === "on",
    };
    const result = await commitImport(context, csvText, options);
    if (!result.ok) return failure(result.message, result.code);
    revalidatePath("/teachers");
    revalidatePath("/users");
    revalidatePath("/supervision/growth");
    return {
      ok: true,
      message: `✓ تم اعتماد ${result.data.applied} إسنادًا. ${result.data.skipped} سجل يحتاج مراجعة.`,
      commit: result.data,
    };
  } catch {
    return failure("حدث خطأ غير متوقع أثناء الاعتماد — أعد المحاولة", "UNKNOWN");
  }
}