import { Skeleton } from "@/components/ui/skeleton";

/** Route-level loading skeleton for /schools and /schools/[id]. */
export default function SchoolsLoading() {
  return (
    <div>
      <div className="mb-6">
        <Skeleton className="mb-3 h-4 w-40" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <div className="rounded-xl border bg-card p-4">
          <Skeleton className="mb-4 h-5 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="mt-3 h-4 w-2/3" />
        </div>
      </div>
    </div>
  );
}