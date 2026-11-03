import { ModulePlaceholderRoute } from "@/components/platform/module-placeholder-route";

export const metadata = {
  title: "الإعدادات",
};

/**
 * Route wrapper for a Phase-1 placeholder module. The real module UI
 * replaces this file when its implementation phase begins — the nav
 * configuration stays untouched.
 */
export default function Page() {
  return <ModulePlaceholderRoute moduleId="settings" />;
}