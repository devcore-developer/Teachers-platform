import { Skeleton } from "@/components/ui/skeleton";

/** Route-level loading state for the user directory (honest skeleton). */
export default function UsersLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-44 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-96 w-full rounded-xl" />
      <span className="sr-only">جارٍ تحميل دليل المستخدمين…</span>
    </div>
  );
}