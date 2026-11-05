"use client";

import * as React from "react";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, TriangleAlert, XCircle } from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import {
  commitImportAction,
  previewImportAction,
  type ImportActionState,
} from "@/app/actions/staffing";
import type { ImportPreview } from "@/lib/staffing/import";

const initialState: ImportActionState = { ok: false };

/**
 * The import wizard: choose file -> server preview (readiness counts +
 * per-row status) -> options -> approve. The approve step re-posts the
 * SAME file text and the server re-validates everything.
 */
export function ImportClient() {
  const { toast } = useToast();
  const [previewState, previewAction, previewPending] = React.useActionState(
    previewImportAction,
    initialState
  );
  const [commitState, commitAction, commitPending] = React.useActionState(
    commitImportAction,
    initialState
  );
  const [csvText, setCsvText] = React.useState("");

  React.useEffect(() => {
    if (previewState.ok && previewState.preview) {
      setCsvText(JSON.stringify(previewState.preview.rows));
    }
  }, [previewState]);

  React.useEffect(() => {
    if (commitState.ok && commitState.commit) {
      toast({
        title: "تم الاعتماد",
        description: commitState.message,
      });
    }
  }, [commitState, toast]);

  const preview = previewState.ok ? previewState.preview : undefined;
  const commit = commitState.ok ? commitState.commit : undefined;

  return (
    <div className="space-y-6">
      {/* Step 1 — template + file */}
      <div className="flex flex-wrap items-center gap-3">
        <a
          href="/api/import/template"
          className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition-colors hover:bg-accent"
        >
          <Download className="size-4" aria-hidden="true" />
          تحميل قالب Excel (CSV)
        </a>
        <form action={previewAction} className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-700">
            <FileSpreadsheet className="size-4" aria-hidden="true" />
            اختيار ملف Excel/CSV
            <input
              type="file"
              name="file"
              accept=".csv,text/csv"
              className="sr-only"
              required
            />
          </label>
          <button
            type="submit"
            disabled={previewPending}
            className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition-colors hover:bg-accent disabled:opacity-60"
          >
            {previewPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            عرض المطابقة
          </button>
        </form>
      </div>

      {previewState.message && !previewState.ok && (
        <p className="rounded-xl border border-error/30 bg-error-soft px-4 py-3 text-sm text-error">
          {previewState.message}
        </p>
      )}

      {/* Step 2 — counts + preview table */}
      {preview && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-xl border bg-background/60 p-3">
              <p className="text-xl font-black tabular-nums">{preview.total}</p>
              <p className="text-xs text-muted-foreground">إجمالي السجلات</p>
            </div>
            <div className="rounded-xl border bg-background/60 p-3">
              <p className="text-xl font-black tabular-nums text-brand-700">{preview.ready}</p>
              <p className="text-xs text-muted-foreground">مطابقة جاهزة</p>
            </div>
            <div className="rounded-xl border bg-background/60 p-3">
              <p className="text-xl font-black tabular-nums text-amber-600">
                {preview.needsReview}
              </p>
              <p className="text-xs text-muted-foreground">تحتاج مراجعة</p>
            </div>
            <div className="rounded-xl border bg-background/60 p-3">
              <p className="text-xl font-black tabular-nums text-error">
                {preview.missingTeacher}
              </p>
              <p className="text-xs text-muted-foreground">غير موجودة</p>
            </div>
          </div>

          <div className="max-h-80 overflow-auto rounded-xl border">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="sticky top-0 bg-muted/80">
                <tr className="text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-start font-semibold">#</th>
                  <th className="px-3 py-2 text-start font-semibold">اسم المعلم</th>
                  <th className="px-3 py-2 text-start font-semibold">المشرف المسند إليه</th>
                  <th className="px-3 py-2 text-start font-semibold">الوكيل</th>
                  <th className="px-3 py-2 text-start font-semibold">المجمع التعليمي</th>
                  <th className="px-3 py-2 text-start font-semibold">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.index} className="border-t">
                    <td className="px-3 py-2 tabular-nums">{row.index + 1}</td>
                    <td className="px-3 py-2 font-semibold">{row.name}</td>
                    <td className="px-3 py-2">{row.supervisor || "—"}</td>
                    <td className="px-3 py-2">{row.deputy || "—"}</td>
                    <td className="px-3 py-2">{row.school || "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          row.status === "ready"
                            ? "inline-flex items-center gap-1 text-xs font-bold text-brand-700"
                            : row.status === "needs_review"
                              ? "inline-flex items-center gap-1 text-xs font-bold text-amber-600"
                              : "inline-flex items-center gap-1 text-xs font-bold text-error"
                        }
                      >
                        {row.status === "ready" ? (
                          <CheckCircle2 className="size-3.5" aria-hidden="true" />
                        ) : row.status === "needs_review" ? (
                          <TriangleAlert className="size-3.5" aria-hidden="true" />
                        ) : (
                          <XCircle className="size-3.5" aria-hidden="true" />
                        )}
                        {row.statusLabel}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Step 3 — approve */}
          <form action={commitAction} className="space-y-3">
            <input type="hidden" name="csvText" value={csvText} />
            <div className="flex flex-col gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="createMissingAccounts"
                  defaultChecked
                  className="size-4 accent-brand-600"
                />
                إنشاء حسابات غير مفعّلة للمعلمين غير الموجودين (بريد مؤقت @manarat.local —
                التفعيل خطوة يدوية)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="updateSchool"
                  defaultChecked
                  className="size-4 accent-brand-600"
                />
                تحديث المجمع التعليمي للمعلمين عند مطابقة الاسم
              </label>
            </div>
            <button
              type="submit"
              disabled={commitPending || preview.ready === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
            >
              {commitPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              ✓ اعتماد الإسناد
            </button>
          </form>
        </div>
      )}

      {/* Commit result */}
      {commit && (
        <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4">
          <p className="text-sm font-bold text-brand-800">{commitState.message}</p>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground" role="list">
            <li>تم اعتماد: {commit.applied}</li>
            <li>تم تخطي/مراجعة: {commit.skipped}</li>
            <li>حسابات جديدة غير مفعّلة: {commit.createdAccounts}</li>
            {commit.notes.slice(0, 8).map((note, index) => (
              <li key={index} className="text-amber-700">
                • {note}
              </li>
            ))}
            {commit.notes.length > 8 && <li>… و{commit.notes.length - 8} ملاحظات أخرى</li>}
          </ul>
        </div>
      )}
    </div>
  );
}