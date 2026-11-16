import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { CircleOff, Clock, GraduationCap, Link2Off } from "lucide-react";

import { AuthCard } from "@/components/auth/auth-card";
import {
  resolveRegisterBranding,
  resolveRegisterEntry,
} from "@/lib/registration-links/service";
import { RegisterForm } from "./register-form";

export const metadata = {
  title: "تسجيل معلم جديد | منارة قرطبة",
};

export const dynamic = "force-dynamic";

type FailureState = "expired" | "revoked" | "school_closed" | "invalid";

/**
 * Public teacher self-registration gate — the target of the school
 * registration links generated at /registration-links:
 *   {app-base}/register/{raw-token}
 *
 * The token is resolved SERVER-SIDE (`resolveRegisterEntry`): the
 * school association comes exclusively from the stored link record, so
 * a tampered URL can never register into another school. The raw token
 * exists only in the URL the manager copied once at creation — the
 * database stores its SHA-256 hash exclusively. A legacy school-slug
 * param resolves to a friendly "registration runs through your
 * school's dedicated link" screen: a slug can never mint a live link.
 */
export default async function RegisterPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: rawParam } = await params;
  const resolved = await resolveRegisterBranding(rawParam);
  const wrapperStyle = resolved.cssVars as CSSProperties;

  const entry = await resolveRegisterEntry(rawParam);

  if (entry.kind === "token" && entry.resolution.status === "valid") {
    return (
      <div style={wrapperStyle}>
        <AuthCard
          branding={resolved.branding}
          title="تسجيل معلم جديد"
          description="أنشئ حسابك المهني عبر رابط مدرستك المخصص — بياناتك تبقى داخل مدرستك، ويُوثَّق بريدك، ثم يُسند إليك مشرفك التربوي."
        >
          <RegisterForm
            token={rawParam}
            branches={entry.resolution.branches}
            expiresAt={entry.resolution.expiresAt}
          />
        </AuthCard>
      </div>
    );
  }

const state: FailureState =
  entry.kind === "school_closed"
    ? "school_closed"
    : entry.kind === "token" && entry.resolution.status !== "valid"
      ? entry.resolution.status
      : "invalid";

  const screen: Record<
    FailureState,
    { Icon: typeof Clock; headline: string; hint: string }
  > = {
    expired: {
      Icon: Clock,
      headline: "انتهت صلاحية رابط التسجيل",
      hint: "روابط التسجيل قد تحمل مدة صلاحية محددة تحددها إدارة المدرسة — اطلب رابطًا جديدًا من إدارة مدرستك ثم أكمل التسجيل خلال مدته.",
    },
    revoked: {
      Icon: CircleOff,
      headline: "أُغلق التسجيل لهذه المدرسة",
      hint: "تم إلغاء رابط التسجيل أو استبداله برابط أحدث — اطلب الرابط الحالي من إدارة مدرستك. حسابات المعلمين المسجلة سابقًا لم تتأثر.",
    },
    school_closed: {
      Icon: GraduationCap,
      headline: "التسجيل يتم عبر رابط مدرستك المخصص",
      hint: "لكل مدرسة رابط تسجيل خاص يولّده مديرها ويشاركه مع معلميها — اطلب رابط مدرستك من إدارتك، فلا يمكن التسجيل باسم المدرسة مباشرة.",
    },
    invalid: {
      Icon: Link2Off,
      headline: "رابط التسجيل غير صالح",
      hint: "تأكد من فتح الرابط الكامل كما وصلك من إدارة مدرستك، دون تعديل أو حذف أي جزء منه.",
    },
  };

  const { Icon, headline, hint } = screen[state];

  return (
    <div style={wrapperStyle}>
      <AuthCard
        branding={resolved.branding}
        className="max-w-md"
        compact
        title="تسجيل معلم جديد"
        description="التسجيل الذاتي للمعلمين يجري حصريًا عبر الروابط المخصصة التي تولّدها إدارة المدرسة."
      >
        <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-5 text-center">
          <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <p className="mt-3 text-sm font-extrabold text-amber-800">{headline}</p>
          <p className="mt-1.5 text-xs leading-relaxed text-amber-700">{hint}</p>
        </div>
        <Link
          href="/login"
          className="mt-4 block rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-center text-sm font-bold text-brand-700 transition-colors hover:bg-brand-100"
        >
          لديك حساب بالفعل؟ سجّل الدخول
        </Link>
      </AuthCard>
    </div>
  );
}