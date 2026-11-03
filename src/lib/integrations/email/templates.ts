/**
 * Phase 11 — Arabic RTL transactional email templates.
 *
 * All templates render server-side into self-contained HTML (inline CSS,
 * dir="rtl") plus a plain-text fallback. Values are HTML-escaped; the
 * only URL interpolated into an href is the app's own absolute URL built
 * from APP_PUBLIC_ORIGIN (validated by appPublicOrigin()).
 *
 * Bilingual support: the platform UI is Arabic-first, so emails ship in
 * Arabic only — no half-translated English mirrors (consistent with the
 * rest of the product).
 */

const PLATFORM_NAME = "منصة تطوير المعلمين بمنارة قرطبة";
const BRAND_BLUE = "#1D5BD6";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Arabic date+time formatting consistent with the in-app formatDate. */
export function formatEmailDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
    numberingSystem: "latn",
  }).format(value);
}

function layout(options: {
  title: string;
  bodyHtml: string;
  schoolName?: string | null;
  cta?: { label: string; url: string } | null;
  footerNote?: string | null;
}): { html: string; text: string } {
  const { title, bodyHtml, schoolName, cta, footerNote } = options;
  const issuer = schoolName ? `${PLATFORM_NAME} — ${schoolName}` : PLATFORM_NAME;
  const ctaHtml = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto 0"><tr><td style="border-radius:10px;background:${BRAND_BLUE}"><a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:12px 28px;font-family:Tahoma,Arial,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px">${escapeHtml(cta.label)}</a></td></tr></table>`
    : "";
  const ctaText = cta ? `\n${cta.label}: ${cta.url}` : "";
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Tahoma,Arial,sans-serif;direction:rtl">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;border:1px solid #e2e8f0;overflow:hidden">
        <tr><td style="background:${BRAND_BLUE};padding:20px 28px;text-align:center">
          <div style="color:#ffffff;font-size:16px;font-weight:bold">${escapeHtml(issuer)}</div>
        </td></tr>
        <tr><td style="padding:28px">
          <h1 style="margin:0 0 14px;font-size:19px;color:#0f172a;line-height:1.6">${escapeHtml(title)}</h1>
          <div style="font-size:14px;color:#334155;line-height:1.9">${bodyHtml}</div>
          ${ctaHtml}
        </td></tr>
        <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 28px">
          <p style="margin:0;font-size:12px;color:#64748b;line-height:1.8">${
            footerNote
              ? escapeHtml(footerNote)
              : "هذه رسالة آلية من المنصة. لإدارة تفضيلات الإشعارات تفضّل بزيارة صفحة «تفضيلات الإشعارات» داخل حسابك."
          }</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  const text = `${title}\n\n${stripTags(bodyHtml)}${ctaText}\n\n— ${issuer}`;
  return { html, text };
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export type EmailTemplateKey =
  | "verify-email"
  | "password-reset"
  | "password-changed"
  | "account-activated"
  | "assignment-published"
  | "assignment-deadline-reminder"
  | "submission-received"
  | "submission-returned"
  | "submission-graded"
  | "certificate-issued"
  | "certificate-revoked"
  | "survey-published"
  | "followup-created"
  | "followup-updated"
  | "followup-status-changed"
  | "followup-shared"
  | "course-completed"
  | "generic-notification";

export interface EmailTemplateParams {
  recipientName?: string | null;
  schoolName?: string | null;
  /** Absolute URL (already includes the origin) — validated by callers. */
  actionUrl?: string | null;
  // Template-specific fields.
  verificationUrl?: string;
  resetUrl?: string;
  titleAr?: string;
  bodyAr?: string;
  dueAtText?: string;
  dateText?: string;
  scoreText?: string;
  reasonText?: string;
  closesAtText?: string;
  statusText?: string;
  courseTitleAr?: string;
}

function greeting(params: EmailTemplateParams): string {
  return params.recipientName
    ? `السلام عليكم <strong>${escapeHtml(params.recipientName)}</strong>،`
    : "السلام عليكم،";
}

/**
 * Renders one of the known templates. Returns null for unknown keys or
 * when a required parameter is missing — callers treat that as a VALIDATION
 * failure rather than sending a broken message.
 */
export function renderEmailTemplate(
  key: EmailTemplateKey,
  params: EmailTemplateParams,
): RenderedEmail | null {
  const name = params.schoolName ?? null;
  const cta = params.actionUrl
    ? { label: "فتح المنصة", url: params.actionUrl }
    : null;

  switch (key) {
    case "verify-email": {
      const url = params.verificationUrl;
      if (!url) return null;
      const rendered = layout({
        title: "تأكيد البريد الإلكتروني وتفعيل الحساب",
        bodyHtml: `${greeting(params)}<br>تفعيل حسابك على المنصة يتطلب تأكيد بريدك الإلكتروني. اضغط الزر أدناه — الرابط صالح لمدة <strong>24 ساعة</strong> ولمرة واحدة فقط.<br><span style="color:#64748b;font-size:12px">إن لم تطلب هذا الطلب فتجاهل هذه الرسالة؛ لن يتغير حسابك.</span>`,
        cta: { label: "تأكيد البريد وتفعيل الحساب", url },
        schoolName: name,
        footerNote: "هذا الرابط لأغراض الأمان ولمرة واحدة. لا تشاركه مع أي أحد.",
      });
      return { subject: "تأكيد البريد الإلكتروني — منصة تطوير المعلمين", ...rendered };
    }
    case "password-reset": {
      const url = params.resetUrl;
      if (!url) return null;
      const rendered = layout({
        title: "إعادة تعيين كلمة المرور",
        bodyHtml: `${greeting(params)}<br>وصلنا طلب لإعادة تعيين كلمة مرور حسابك. الرابط أدناه صالح لمدة <strong>ساعة واحدة</strong> ولمرة واحدة فقط.<br><span style="color:#64748b;font-size:12px">إن لم تطلب إعادة التعيين فتجاهل الرسالة، وكلمة مرورك الحالية باقية كما هي.</span>`,
        cta: { label: "إعادة تعيين كلمة المرور", url },
        schoolName: name,
        footerNote: "لن يرسل لك فريق المنصة كلمة المرور أبدًا ولا يطلبها منك.",
      });
      return { subject: "إعادة تعيين كلمة المرور — منصة تطوير المعلمين", ...rendered };
    }
    case "password-changed": {
      const rendered = layout({
        title: "تم تغيير كلمة مرور حسابك",
        bodyHtml: `${greeting(params)}<br>تم تغيير كلمة مرور حسابك بنجاح${params.dateText ? ` بتاريخ <strong>${escapeHtml(params.dateText)}</strong>` : ""}. وجّهت جميع الجلسات النشطة إلى تسجيل خروج تلقائي حفاظًا على أمان حسابك.<br><span style="color:#64748b;font-size:12px">إن لم تقم أنت بهذا التغيير فتواصل مع إدارة المدرسة فورًا.</span>`,
        schoolName: name,
      });
      return { subject: "تنبيه أمني: تم تغيير كلمة مرورك", ...rendered };
    }
    case "account-activated": {
      const rendered = layout({
        title: "تم تفعيل حسابك بنجاح",
        bodyHtml: `${greeting(params)}<br>تم تأكيد بريدك الإلكتروني وتفعيل حسابك داخل المنصة. يمكنك الآن الاطلاع على لوحتك ومتابعة مهامك التدريبية.`,
        cta,
        schoolName: name,
      });
      return { subject: "تم تفعيل حسابك — منصة تطوير المعلمين", ...rendered };
    }
    case "assignment-published": {
      if (!params.titleAr) return null;
      const rendered = layout({
        title: "واجب جديد متاح لك",
        bodyHtml: `${greeting(params)}<br>نُشر واجب جديد<strong>«${escapeHtml(params.titleAr)}»</strong>${
          params.dueAtText ? ` وتاريخ التسليم: <strong>${escapeHtml(params.dueAtText)}</strong>` : ""
        }. يمكنك مراجعة المتطلبات وتقديم إجابتك من خلال لوحتك.`,
        cta,
        schoolName: name,
      });
      return { subject: `واجب جديد: ${params.titleAr}`, ...rendered };
    }
    case "assignment-deadline-reminder": {
      if (!params.titleAr) return null;
      const rendered = layout({
        title: "تذكير: موعد تسليم واجب يقترب",
        bodyHtml: `${greeting(params)}<br>نذكّرك بأن موعد تسليم واجب<strong>«${escapeHtml(params.titleAr)}»</strong> يقترب${
          params.dueAtText ? ` — بتاريخ: <strong>${escapeHtml(params.dueAtText)}</strong>` : ""
        }. لم نستلم تسليمك بعد.`,
        cta,
        schoolName: name,
      });
      return { subject: `تذكير بموعد التسليم: ${params.titleAr}`, ...rendered };
    }
    case "submission-received": {
      if (!params.titleAr) return null;
      const rendered = layout({
        title: "استلام تسليم جديد للمراجعة",
        bodyHtml: `${greeting(params)}<br>استلم المعلم${
          params.recipientName ? "" : ""
        } تسليمًا جديدًا على واجب<strong>«${escapeHtml(params.titleAr)}»</strong>، وهو بانتظار المراجعة في قائمة مراجعاتك.`,
        cta,
        schoolName: name,
      });
      return { subject: `تسليم جديد بانتظار المراجعة: ${params.titleAr}`, ...rendered };
    }
    case "submission-returned": {
      if (!params.titleAr) return null;
      const rendered = layout({
        title: "أُعيد تسليمك للتعديل",
        bodyHtml: `${greeting(params)}<br>أعاد المراجع تسليمك على واجب<strong>«${escapeHtml(params.titleAr)}»</strong> مع ملاحظات للتعديل. راجع التغذية الراجعة ثم أعد التقديم خلال نافذة التسليم المتاحة.`,
        cta,
        schoolName: name,
      });
      return { subject: `أُعيد تسليمك للتعديل: ${params.titleAr}`, ...rendered };
    }
    case "submission-graded": {
      if (!params.titleAr) return null;
      const rendered = layout({
        title: "تم تقييم تسليمك",
        bodyHtml: `${greeting(params)}<br>تم تقييم تسليمك على واجب<strong>«${escapeHtml(params.titleAr)}»</strong>${
          params.scoreText ? ` ونتيجتك: <strong>${escapeHtml(params.scoreText)}</strong>` : ""
        }. يمكنك الاطلاع على معايير التقييم والتغذية الراجعة الكاملة.`,
        cta,
        schoolName: name,
      });
      return { subject: `تم تقييم تسليمك: ${params.titleAr}`, ...rendered };
    }
    case "certificate-issued": {
      if (!params.titleAr) return null;
      const rendered = layout({
        title: "صادرت لك شهادة جديدة",
        bodyHtml: `${greeting(params)}<br>أصدرت إدارة المدرسة شهادة<strong>«${escapeHtml(params.titleAr)}»</strong> بسبب استيفائك متطلبات الإنجاز. يمكنك عرضها وطباعتها من صفحة شهاداتك.`,
        cta,
        schoolName: name,
      });
      return { subject: `شهادة جديدة: ${params.titleAr}`, ...rendered };
    }
    case "certificate-revoked": {
      if (!params.titleAr) return null;
      const rendered = layout({
        title: "أُلغيت شهادة صادرة باسمك",
        bodyHtml: `${greeting(params)}<br>ألغت إدارة المدرسة شهادة<strong>«${escapeHtml(params.titleAr)}»</strong>${
          params.reasonText ? ` والسبب المُعلن: «${escapeHtml(params.reasonText)}»` : ""
        }. للاستفسار تواصل مع مدير مكتب التطوير في مدرستك.`,
        schoolName: name,
      });
      return { subject: `إلغاء شهادة: ${params.titleAr}`, ...rendered };
    }
    case "survey-published": {
      if (!params.titleAr) return null;
      const rendered = layout({
        title: "استبيان جديد متاح لك",
        bodyHtml: `${greeting(params)}<br>نُشر استبيان<strong>«${escapeHtml(params.titleAr)}»</strong>${
          params.closesAtText ? ` ويُغلق باب الإجابة بتاريخ: <strong>${escapeHtml(params.closesAtText)}</strong>` : ""
        }. رأيك يثري قرارات التطوير — يستغرق الإجابة دقائق.`,
        cta,
        schoolName: name,
      });
      return { subject: `استبيان جديد: ${params.titleAr}`, ...rendered };
    }
    case "followup-created": {
      if (!params.titleAr) return null;
      const rendered = layout({
        title: "زيارة متابعة ميدانية مجدولة",
        bodyHtml: `${greeting(params)}<br>جدول المشرف زيارة متابعة<strong>«${escapeHtml(params.titleAr)}»</strong>${
          params.dateText ? ` بتاريخ: <strong>${escapeHtml(params.dateText)}</strong>` : ""
        }. تفاصيل الزيارة متاحة في صفحة متابعاتك.`,
        cta,
        schoolName: name,
      });
      return { subject: `متابعة ميدانية مجدولة: ${params.titleAr}`, ...rendered };
    }
    case "followup-updated": {
      if (!params.titleAr) return null;
      const rendered = layout({
        title: "تحديث على زيارة متابعة",
        bodyHtml: `${greeting(params)}<br>حُدّثت زيارة المتابعة<strong>«${escapeHtml(params.titleAr)}»</strong>${
          params.dateText ? ` والموعد الجديد: <strong>${escapeHtml(params.dateText)}</strong>` : ""
        }. راجع التفاصيل المحدثة.`,
        cta,
        schoolName: name,
      });
      return { subject: `تحديث متابعة: ${params.titleAr}`, ...rendered };
    }
    case "followup-status-changed": {
      if (!params.titleAr) return null;
      const rendered = layout({
        title: "تغيّرت حالة زيارة متابعة",
        bodyHtml: `${greeting(params)}<br>تغيّرت حالة المتابعة<strong>«${escapeHtml(params.titleAr)}»</strong>${
          params.statusText ? ` إلى: <strong>${escapeHtml(params.statusText)}</strong>` : ""
        }.`,
        cta,
        schoolName: name,
      });
      return { subject: `تحديث حالة المتابعة: ${params.titleAr}`, ...rendered };
    }
    case "followup-shared": {
      if (!params.titleAr) return null;
      const rendered = layout({
        title: "أُضيفت متابعة مشتركة إليك",
        bodyHtml: `${greeting(params)}<br>تم تفعيل مشاركة المتابعة<strong>«${escapeHtml(params.titleAr)}»</strong> معك — أصبح بإمكانك الاطلاع على الملخص والتوصيات المتاحة لك.`,
        cta,
        schoolName: name,
      });
      return { subject: `متابعة مشتركة معك: ${params.titleAr}`, ...rendered };
    }
    case "course-completed": {
      if (!params.courseTitleAr) return null;
      const rendered = layout({
        title: "أحسنت — أكملت مقررًا تدريبيًا",
        bodyHtml: `${greeting(params)}<br>استوفيت جميع متطلبات مقرر<strong>«${escapeHtml(params.courseTitleAr)}»</strong> وفق قواعد الإكمال المعتمدة. قد تكون مؤهلًا لشهادة إتمام — راجع صفحة النمو المهني.`,
        cta,
        schoolName: name,
      });
      return { subject: `إكمال مقرر: ${params.courseTitleAr}`, ...rendered };
    }
    case "generic-notification": {
      if (!params.titleAr) return null;
      const rendered = layout({
        title: params.titleAr,
        bodyHtml: `${greeting(params)}<br>${escapeHtml(params.bodyAr ?? "")}`,
        cta,
        schoolName: name,
      });
      return { subject: params.titleAr, ...rendered };
    }
    default:
      return null;
  }
}