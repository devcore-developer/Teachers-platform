"use client";

import { ModulePlaceholder } from "@/components/platform/module-placeholder";
import { getNavItemId } from "@/config/navigation";

interface ModulePlaceholderRouteProps {
  moduleId: string;
}

/**
 * Client bridge for placeholder module routes. Server pages resolve the
 * serializable moduleId; the icon-bearing NavItem is resolved here on
 * the client (icons are component references and cannot cross the
 * server/client serialization boundary).
 */
export function ModulePlaceholderRoute({ moduleId }: ModulePlaceholderRouteProps) {
  const navItem = getNavItemId(moduleId);
  if (!navItem) return null;
  return <ModulePlaceholder module={navItem} />;
}