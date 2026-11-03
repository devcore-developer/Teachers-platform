import nodemailer, { type Transporter } from "nodemailer";

/* ------------------------------------------------------------------ */
/* Real email delivery via SMTP (nodemailer).                           */
/*                                                                      */
/* Configuration comes exclusively from environment variables — never   */
/* committed secrets. Two modes:                                        */
/*   EMAIL_MODE=ethereal  DEV ONLY: a throwaway Ethereal test account   */
/*                        is created at runtime; messages are real SMTP */
/*                        deliveries viewable through a preview URL    */
/*                        printed to the SERVER console (the URL does   */
/*                        not contain any token). Never use in prod.    */
/*   otherwise            SMTP_HOST/SMTP_PORT/SMTP_SECURE/SMTP_USER/    */
/*                        SMTP_PASS/MAIL_FROM are used.                 */
/*                                                                      */
/* Honesty contract: senders return { ok: false } on ANY failure and    */
/* callers must not treat the message as sent. Tokens are never logged; */
/* nothing sensitive is embedded in URLs besides the one-time token     */
/* itself (passwords are never in URLs).                                */
/* ------------------------------------------------------------------ */

export interface MailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type MailSender = (
  payload: MailPayload
) => Promise<{ ok: boolean; error?: string }>;

let cachedTransport: Transporter | null | undefined;

async function getTransport(): Promise<Transporter | null> {
  if (cachedTransport !== undefined) return cachedTransport;

  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_SECURE,
    SMTP_USER,
    SMTP_PASS,
    EMAIL_MODE,
  } = process.env;

  if (EMAIL_MODE === "ethereal") {
    // DEV ONLY — throwaway account, real SMTP delivery, web preview.
    const account = await nodemailer.createTestAccount();
    cachedTransport = nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      auth: { user: account.user, pass: account.pass },
    });
    return cachedTransport;
  }

  if (SMTP_HOST) {
    cachedTransport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT ?? 587),
      secure: SMTP_SECURE === "true",
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS ?? "" } : undefined,
    });
    return cachedTransport;
  }

  // No provider configured — senders will report honest failure.
  cachedTransport = null;
  return null;
}

export const defaultMailSender: MailSender = async (payload) => {
  try {
    const transport = await getTransport();
    if (!transport) {
      return { ok: false, error: "smtp_not_configured" };
    }
    const info = await transport.sendMail({
      from: process.env.MAIL_FROM ?? "منارة قرطبة <no-reply@manara-qurtuba.local>",
      ...payload,
    });

    // Dev preview link only — the URL itself contains no token.
    if (process.env.EMAIL_MODE === "ethereal") {
      const preview = nodemailer.getTestMessageUrl(info);
      if (typeof preview === "string") {
        console.info("[mail:dev-preview]", preview);
      }
    }
    return { ok: true };
  } catch (error) {
    console.error(
      "[mail] delivery failed:",
      error instanceof Error ? error.message : error
    );
    return { ok: false };
  }
};

/* ----------------------- Arabic email templates -------------------- */

const shell = (title: string, bodyHtml: string) => `
<!doctype html>
<html lang="ar" dir="rtl">
  <body style="margin:0;padding:24px;background:#f1f5f9;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
      <div style="background:#1D5BD6;padding:20px 24px;color:#ffffff;font-size:18px;font-weight:700;">
        منارة قرطبة — منصة التنمية المهنية للمعلمين
      </div>
      <div style="padding:24px;color:#0f172a;line-height:1.9;">
        <h2 style="margin:0 0 12px;font-size:18px;">${title}</h2>
        ${bodyHtml}
      </div>
      <div style="padding:16px 24px;background:#f8fafc;color:#64748b;font-size:12px;">
        إذا لم تطلب هذه الرسالة يمكنك تجاهلها بأمان — لن يتغير أي شيء في حسابك.
      </div>
    </div>
  </body>
</html>`;

const actionButton = (url: string, label: string) => `
  <p style="margin:20px 0;">
    <a href="${url}" style="display:inline-block;background:#1D5BD6;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;">
      ${label}
    </a>
  </p>
  <p style="font-size:13px;color:#475569;word-break:break-all;">أو انسخ الرابط التالي إلى متصفحك:<br/><span dir="ltr">${url}</span></p>`;

export function buildVerificationEmail(
  name: string,
  verificationUrl: string
): Omit<MailPayload, "to"> {
  const title = `مرحبًا ${name}، أكّد بريدك الإلكتروني`;
  const body = `
    <p>شكرًا لتسجيلك في منصة منارة قرطبة. لتصبح بيانات حسابك موثّقة وتتمكن من تسجيل الدخول، أكّد بريدك الإلكتروني خلال 24 ساعة.</p>
    ${actionButton(verificationUrl, "تأكيد البريد الإلكتروني")}
    <p style="font-size:13px;color:#475569;">رابط التأكيد يُستخدم مرة واحدة فقط وينتهي بعد 24 ساعة.</p>`;
  return {
    subject: "تأكيد البريد الإلكتروني — منصة منارة قرطبة",
    html: shell(title, body),
    text: `مرحبًا ${name}،\nأكّد بريدك الإلكتروني خلال 24 ساعة عبر الرابط التالي (يُستخدم مرة واحدة):\n${verificationUrl}\n\nإذا لم تطلب التسجيل تجاهل هذه الرسالة.`,
  };
}

export function buildPasswordResetEmail(
  name: string,
  resetUrl: string
): Omit<MailPayload, "to"> {
  const title = "إعادة تعيين كلمة المرور";
  const body = `
    <p>وصلنا طلب لإعادة تعيين كلمة مرور حسابك (${name}). الرابط أدناه يُستخدم مرة واحدة وينتهي بعد ساعة واحدة.</p>
    ${actionButton(resetUrl, "اختيار كلمة مرور جديدة")}
    <p style="font-size:13px;color:#475569;">لم تطلب إعادة التعيين؟ تجاهل هذه الرسالة وكلمة مرورك الحالية تعمل كما هي.</p>`;
  return {
    subject: "إعادة تعيين كلمة المرور — منصة منارة قرطبة",
    html: shell(title, body),
    text: `وصلنا طلب لإعادة تعيين كلمة مرور حسابك.\nاستخدم الرابط التالي خلال ساعة (مرة واحدة فقط):\n${resetUrl}\n\nإذا لم تطلب ذلك تجاهل الرسالة.`,
  };
}