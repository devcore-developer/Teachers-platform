/**
 * Phase 11 — transactional email provider abstraction.
 *
 * Design rules:
 *  - Server-side only. Credentials never leave this module; the UI sees
 *    only a configured/not-configured boolean (see integrations status).
 *  - Zero new dependencies: the provider is called over HTTPS with the
 *    platform's global fetch (Resend HTTP API), with a hard timeout.
 *  - Honest results: the caller receives either a real provider message
 *    id or a structured failure with a SANITIZED error category. Nothing
 *    here ever claims success without the provider confirming it.
 *  - Tests inject their own fetch implementation; production never does.
 */

export interface EmailSendInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSendResult {
  /** Provider message id — persisted on EmailDelivery for tracing. */
  messageId: string;
}

/** Sanitized error surfaced to the queue worker (stored on the row). */
export class EmailProviderError extends Error {
  /** One of EMAIL_ERROR_CATEGORIES — safe to persist and display. */
  category: string;
  /** Short, sanitized human message (provider raw text is truncated). */
  detail: string;

  constructor(category: string, detail: string) {
    super(detail);
    this.name = "EmailProviderError";
    this.category = category;
    this.detail = detail;
  }
}

export interface EmailProvider {
  kind: string;
  send(input: EmailSendInput): Promise<EmailSendResult>;
}

export interface ResendProviderConfig {
  apiKey: string;
  from: string;
  /** Optional reply-to address (validated same as from). */
  replyTo?: string;
  timeoutMs?: number;
}

const REQUEST_TIMEOUT_MS_DEFAULT = 10_000;
const MAX_RESPONSE_SNIPPET = 160;

function truncate(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > MAX_RESPONSE_SNIPPET ? `${clean.slice(0, MAX_RESPONSE_SNIPPET)}…` : clean;
}

function categorizeStatus(status: number): string {
  if (status === 401 || status === 403) return "AUTH";
  if (status === 400 || status === 422) return "VALIDATION";
  if (status === 429) return "RATE_LIMIT";
  return "PROVIDER";
}

/**
 * Builds the Resend HTTP provider. `fetchImpl` exists ONLY for tests —
 * production callers use the default global fetch.
 */
export function createResendProvider(
  config: ResendProviderConfig,
  fetchImpl?: typeof fetch,
): EmailProvider {
  const doFetch = fetchImpl ?? fetch;
  return {
    kind: "RESEND",
    async send(input: EmailSendInput): Promise<EmailSendResult> {
      const timeoutMs = config.timeoutMs ?? REQUEST_TIMEOUT_MS_DEFAULT;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await doFetch("https://api.resend.com/emails", {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: config.from,
            to: [input.to],
            subject: input.subject,
            html: input.html,
            text: input.text,
            ...(config.replyTo ? { reply_to: config.replyTo } : {}),
          }),
        });

        if (!response.ok) {
          const bodyText = await response.text().catch(() => "");
          throw new EmailProviderError(
            categorizeStatus(response.status),
            `provider responded ${response.status}: ${truncate(bodyText) || "(no body)"}`,
          );
        }

        const payload = (await response.json().catch(() => null)) as { id?: unknown } | null;
        const messageId = typeof payload?.id === "string" ? payload.id : "";
        if (!messageId) {
          throw new EmailProviderError(
            "PROVIDER",
            "provider accepted the message but returned no message id",
          );
        }
        return { messageId };
      } catch (error) {
        if (error instanceof EmailProviderError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new EmailProviderError("NETWORK", `request timed out after ${timeoutMs}ms`);
        }
        throw new EmailProviderError(
          "NETWORK",
          `network failure: ${error instanceof Error ? truncate(error.message) : "unknown"}`,
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/* ---- Configuration resolution ------------------------------------- */

const EMAIL_ADDRESS_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** Extracts the bare address from "Name <a@b.c>" or "a@b.c" forms. */
export function extractEmailAddress(value: string): string | null {
  const angle = value.match(/<\s*([^>]+)\s*>/);
  const candidate = (angle ? angle[1] : value).trim();
  return EMAIL_ADDRESS_RE.test(candidate) ? candidate.toLowerCase() : null;
}

export type ResolvedEmailProvider =
  | { configured: true; provider: EmailProvider; fromAddress: string }
  | { configured: false; reason: string };

/**
 * Resolves the active provider from environment variables. Never throws,
 * never logs secret values — the returned shape is safe to render
 * (booleans + reason keys only; the API key itself is not included).
 *
 * Required environment variables (documented in .env.example):
 *   RESEND_API_KEY  — secret API key for the Resend account.
 *   EMAIL_FROM      — "Platform Name <no-reply@domain>" or "no-reply@domain".
 *   EMAIL_REPLY_TO  — optional.
 */
export function resolveEmailProvider(): ResolvedEmailProvider {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  const from = (process.env.EMAIL_FROM ?? "").trim();
  const replyTo = (process.env.EMAIL_REPLY_TO ?? "").trim();

  if (!apiKey) return { configured: false, reason: "MISSING_RESEND_API_KEY" };
  if (!from) return { configured: false, reason: "MISSING_EMAIL_FROM" };
  const fromAddress = extractEmailAddress(from);
  if (!fromAddress) return { configured: false, reason: "INVALID_EMAIL_FROM" };
  if (replyTo && !extractEmailAddress(replyTo)) {
    return { configured: false, reason: "INVALID_EMAIL_REPLY_TO" };
  }

  return {
    configured: true,
    provider: createResendProvider({
      apiKey,
      from,
      ...(replyTo ? { replyTo: extractEmailAddress(replyTo) ?? undefined } : {}),
    }),
    fromAddress,
  };
}

/** Masks an email for UI display: `ab***@domain.tld`. Never reverses. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${"*".repeat(Math.max(3, Math.min(6, local.length - head.length)))}@${domain}`;
}