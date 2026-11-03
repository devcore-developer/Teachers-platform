"use client";

/**
 * Phase 12 — email-verification confirmation form (client).
 *
 * The single-use token is consumed ONLY when the user presses the
 * confirmation button (POST server action). Link prefetchers, mail
 * scanners and messaging-app preview bots can no longer burn the token
 * by merely opening the emailed URL — they would only render this form.
 */

import { useActionState } from "react";
import { verifyEmailAction, type VerifyEmailActionState } from "@/app/actions/account";
import { Card } from "@/app/assignments/ui";

const initialState: VerifyEmailActionState = { ok: false };

const FAILURE_MESSAGES: Record<string, { title: string; hint: string }> = {
  INVALID: {
    title: "الرابط غير صالح",
    hint: "رابط التأكيد غير صحيح أو تم حذفه. اطلب رابطًا جديدًا من إدارة مدرستك أو أعد الطلب إن كانت الخدمة متاحة.",
  },
  EXPIRED: {
    title: "انتهت صلاحية الرابط",
    hint: "روابط التأكيد صالحة لمدة 24 ساعة فقط. اطلب رابطًا جديدًا لإكمال التفعيل.",
  },
  USED: {
    title: "تم استخدام الرابط مسبقًا",
    hint: "روابط التأكيد تُستخدم مرة واحدة فقط. إن لم يكن حسابك مفعّلًا بعد فاطلب رابطًا جديدًا.",
  },
};

export function VerifyEmailForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(
    async (prev: VerifyEmailActionState, formData: FormData) =>
      verifyEmailAction(prev, formData),
    initialState,
  );

  if (state.status === "ACTIVATED") {
    return (
      <Card title="تم تأكيد بريدك وتفعيل حسابك">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-bold text-emerald-700">
            أصبح بريدك الإلكتروني مؤكدًا وتم تفعيل حسابك داخل المنصة.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-emerald-600">
            أرسلنا لك إشعارًا داخليًا بالتفعيل — تجده في جرس الإشعارات أعلى الصفحة.
          </p>
        </div>
        <a
          href="/dashboard"
          className="mt-4 inline-flex rounded-lg bg-[#1D5BD6] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#174aa8]"
        >
          الانتقال إلى لوحتي
        </a>
      </Card>
    );
  }

  if (state.status === "ALREADY_VERIFIED") {
    return (
      <Card title="حسابك مؤكد مسبقًا">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-bold text-emerald-700">
            كان بريدك الإلكتروني مؤكدًا من قبل — لا حاجة لأي إجراء.
          </p>
        </div>
        <a
          href="/dashboard"
          className="mt-4 inline-flex rounded-lg bg-[#1D5BD6] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#174aa8]"
        >
          الانتقال إلى لوحتي
        </a>
      </Card>
    );
  }

  if (
    state.status === "INVALID" ||
    state.status === "EXPIRED" ||
    state.status === "USED"
  ) {
    const failure = FAILURE_MESSAGES[state.status];
    return (
      <Card title="تعذّر تأكيد البريد">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-bold text-red-700">{failure.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-red-600">{failure.hint}</p>
        </div>
      </Card>
    );
  }

  return (
    <Card title="تأكيد بريدك الإلكتروني">
      <p className="text-sm leading-relaxed text-slate-600">
        وصل رابط التأكيد الخاص بك. اضغط الزر أدناه لإكمال تفعيل حسابك — لن يتم
        أي إجراء قبل تأكيدك الصريح.
      </p>
      <form action={formAction} className="mt-4">
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center rounded-lg bg-[#1D5BD6] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#174aa8] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "جارٍ التأكيد…" : "تأكيد بريدي وتفعيل حسابي"}
        </button>
      </form>
    </Card>
  );
}