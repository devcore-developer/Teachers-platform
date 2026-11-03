/**
 * Phase 8 — server-side QR rendering for certificate sheets.
 *
 * `qrcode` is the only new dependency in this phase (pure JS,
 * maintained, no native bindings) — sanctioned by the Phase 8 brief
 * for QR generation. The helper degrades gracefully: on any failure
 * the certificate falls back to printing the verification URL text.
 */
import QRCode from "qrcode";

export async function qrDataUrl(text: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(text, {
      width: 240,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0F172A", light: "#FFFFFF" },
    });
  } catch {
    return null;
  }
}