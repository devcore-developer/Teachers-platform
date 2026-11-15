// src/app/register/[token]/layout.tsx
// Route layout — a pure passthrough. Identity (branding, colors, shell)
// is resolved per-request in page.tsx from the registration link's
// school, so this layout deliberately imports nothing.

import type { ReactNode } from "react";

export default function RegisterTokenLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <div dir="rtl">{children}</div>;
}