"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, Plus, Search, School as SchoolIcon } from "lucide-react";

import { EmptyState } from "@/components/platform/empty-state";
import { StatusBadge } from "@/components/platform/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { schoolInitials, type SchoolListItem } from "@/lib/schools/dto";

type StatusFilter = "all" | "active" | "inactive";

const statusFilters: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "الكل" },
  { value: "active", label: "النشطة" },
  { value: "inactive", label: "الموقوفة" },
];

/** Fallback avatar: initials on a brand-colored tile. */
function SchoolAvatar({ school }: { school: SchoolListItem }) {
  return school.logoUrl ? (
    <img
      src={school.logoUrl}
      alt={`شعار ${school.nameAr}`}
      className="size-10 shrink-0 rounded-full border bg-card object-cover"
      onError={(event) => {
        event.currentTarget.style.display = "none";
      }}
    />
  ) : (
    <span
      className="flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
      style={{ backgroundColor: school.brandColor }}
      aria-hidden="true"
    >
      {schoolInitials(school.nameAr)}
    </span>
  );
}

/**
 * Schools directory: real-time client-side search (Arabic/English/slug)
 * and status filtering over the persisted list. Desktop renders a
 * table; small screens render stacked cards.
 */
export function SchoolsDirectory({ schools }: { schools: SchoolListItem[] }) {
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("all");

  const normalizedQuery = query.trim();
  const filtered = React.useMemo(() => {
    const q = normalizedQuery.toLowerCase();
    return schools.filter((school) => {
      const matchesStatus =
        status === "all" ||
        (status === "active" && school.isActive) ||
        (status === "inactive" && !school.isActive);
      if (!matchesStatus) return false;
      if (q.length === 0) return true;
      return (
        school.nameAr.includes(normalizedQuery) ||
        (school.nameEn?.toLowerCase().includes(q) ?? false) ||
        school.slug.includes(q)
      );
    });
  }, [schools, normalizedQuery, status]);

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحث باسم المدرسة أو الرابط المختصر…"
            className="ps-9"
            aria-label="البحث في المدارس"
          />
        </div>
        <div
          className="flex w-fit items-center gap-1 rounded-lg border bg-card p-1"
          role="group"
          aria-label="تصفية حسب الحالة"
        >
          {statusFilters.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setStatus(filter.value)}
              aria-pressed={status === filter.value}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-bold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                status === filter.value
                  ? "bg-brand-600 text-white shadow-xs"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {schools.length === 0 ? (
        <div className="rounded-xl border bg-card shadow-xs">
          <EmptyState
            icon={SchoolIcon}
            title="لا توجد مدارس مسجلة بعد"
            description="ابدأ بإضافة أول مدرسة لتبني عليها الفروع والمراحل التعليمية وباقي وحدات المنصة."
            action={
              <Button asChild>
                <Link href="/schools/new">
                  <Plus className="size-4" aria-hidden="true" />
                  إضافة أول مدرسة
                </Link>
              </Button>
            }
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border bg-card shadow-xs">
          <EmptyState
            icon={Search}
            title="لا توجد نتائج مطابقة"
            description="جرّب تعديل كلمة البحث أو تغيير فلتر الحالة."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setQuery("");
                  setStatus("all");
                }}
              >
                إعادة ضبط البحث
              </Button>
            }
          />
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden rounded-xl border bg-card shadow-xs md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="py-3.5 ps-5">المدرسة</TableHead>
                  <TableHead className="py-3.5">الرابط المختصر</TableHead>
                  <TableHead className="py-3.5 text-center">الفروع</TableHead>
                  <TableHead className="py-3.5">الحالة</TableHead>
                  <TableHead className="py-3.5">تاريخ الإضافة</TableHead>
                  <TableHead className="py-3.5 pe-5">
                    <span className="sr-only">فتح التفاصيل</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((school) => (
                  <TableRow key={school.id}>
                    <TableCell className="py-3.5 ps-5">
                      <Link
                        href={`/schools/${school.id}`}
                        className="group flex items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <SchoolAvatar school={school} />
                        <span className="min-w-0 leading-tight">
                          <span className="block truncate text-sm font-bold text-foreground transition-colors group-hover:text-brand-700">
                            {school.nameAr}
                          </span>
                          {school.nameEn && (
                            <span className="block truncate text-xs text-muted-foreground" dir="ltr">
                              {school.nameEn}
                            </span>
                          )}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="py-3.5">
                      <code
                        className="rounded-md bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground"
                        dir="ltr"
                      >
                        {school.slug}
                      </code>
                    </TableCell>
                    <TableCell className="py-3.5 text-center">
                      <span className="text-sm font-bold tabular-nums text-foreground">
                        {school.branchesCount}
                      </span>
                    </TableCell>
                    <TableCell className="py-3.5">
                      {school.isActive ? (
                        <StatusBadge tone="success">نشطة</StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">موقوفة</StatusBadge>
                      )}
                    </TableCell>
                    <TableCell className="py-3.5">
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {school.createdAtLabel}
                      </span>
                    </TableCell>
                    <TableCell className="py-3.5 pe-5 text-end">
                      <Link
                        href={`/schools/${school.id}`}
                        aria-label={`فتح تفاصيل ${school.nameAr}`}
                        className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <ChevronLeft className="size-4" aria-hidden="true" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <ul className="space-y-3 md:hidden" role="list" aria-label="قائمة المدارس">
            {filtered.map((school) => (
              <li key={school.id}>
                <Link
                  href={`/schools/${school.id}`}
                  className="block rounded-xl border bg-card p-4 shadow-xs outline-none transition-colors hover:border-brand-200 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-center gap-3">
                    <SchoolAvatar school={school} />
                    <div className="min-w-0 flex-1 leading-tight">
                      <p className="truncate text-sm font-bold text-foreground">
                        {school.nameAr}
                      </p>
                      {school.nameEn && (
                        <p className="truncate text-xs text-muted-foreground" dir="ltr">
                          {school.nameEn}
                        </p>
                      )}
                    </div>
                    {school.isActive ? (
                      <StatusBadge tone="success">نشطة</StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">موقوفة</StatusBadge>
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      الفروع:
                      <span className="font-bold tabular-nums text-foreground">
                        {school.branchesCount}
                      </span>
                    </span>
                    <code className="rounded-md bg-muted px-2 py-0.5 font-semibold" dir="ltr">
                      {school.slug}
                    </code>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Count summary */}
      {schools.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          عرض {filtered.length} من {schools.length} مدرسة
          {status !== "all" && " (وفلتر الحالة)"}
        </p>
      )}
    </div>
  );
}