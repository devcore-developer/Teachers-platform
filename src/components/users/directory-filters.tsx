"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, RotateCcw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionCard } from "@/components/platform/section-card";

/* ------------------------------------------------------------------ */
/* Directory filter bar. A real GET-style navigation: the current       */
/* filters become URL search params, so every view is shareable and    */
/* the SERVER re-queries with the new filters (never client filtering  */
/* of sensitive data).                                                 */
/* ------------------------------------------------------------------ */

interface DirectoryFiltersProps {
  roleOptions: { value: string; label: string }[];
  schools: { id: string; nameAr: string }[];
  branches: { id: string; nameAr: string }[];
  showSchoolFilter: boolean;
}

export function DirectoryFilters({
  roleOptions,
  schools,
  branches,
  showSchoolFilter,
}: DirectoryFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const current = {
    q: searchParams.get("q") ?? "",
    role: searchParams.get("role") ?? "ALL",
    schoolId: searchParams.get("schoolId") ?? "ALL",
    branchId: searchParams.get("branchId") ?? "ALL",
    status: searchParams.get("status") ?? "ALL",
  };

  const [q, setQ] = React.useState(current.q);

  function applyParam(key: string, value: string) {
    const sp = new URLSearchParams(searchParams.toString());
    if (value === "ALL" || value === "") sp.delete(key);
    else sp.set(key, value);
    sp.delete("page"); // any filter change resets pagination
    router.push(`/users${sp.toString() ? `?${sp.toString()}` : ""}`);
  }

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    applyParam("q", q.trim());
  }

  function resetFilters() {
    setQ("");
    router.push("/users");
  }

  const selectClass = "w-full bg-background";

  return (
    <SectionCard
      title="تصفية النتائج"
      description="البحث والفلاتر تُنفَّذ على الخادم ضمن نطاق صلاحيتك — النتائج دائمًا من قاعدة البيانات."
    >
      <form onSubmit={submitSearch} className="space-y-4" noValidate>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="space-y-1.5 xl:col-span-2">
            <Label htmlFor="users-q">بحث بالاسم أو البريد</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="users-q"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="اكتب اسمًا أو بريدًا…"
                className="ps-10"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="users-role">الدور</Label>
            <Select
              value={current.role}
              onValueChange={(value) => applyParam("role", value)}
            >
              <SelectTrigger id="users-role" className={selectClass}>
                <SelectValue placeholder="جميع الأدوار" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">جميع الأدوار</SelectItem>
                {roleOptions.map((role) => (
                  <SelectItem key={role.value} value={role.value}>
                    {role.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {showSchoolFilter && (
            <div className="space-y-1.5">
              <Label htmlFor="users-school">المدرسة</Label>
              <Select
                value={current.schoolId}
                onValueChange={(value) => applyParam("schoolId", value)}
              >
                <SelectTrigger id="users-school" className={selectClass}>
                  <SelectValue placeholder="جميع المدارس" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">جميع المدارس</SelectItem>
                  {schools.map((school) => (
                    <SelectItem key={school.id} value={school.id}>
                      {school.nameAr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="users-branch">الفرع</Label>
            {branches.length > 0 ? (
              <Select
                value={current.branchId}
                onValueChange={(value) => applyParam("branchId", value)}
              >
                <SelectTrigger id="users-branch" className={selectClass}>
                  <SelectValue placeholder="جميع الفروع" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">جميع الفروع</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.nameAr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="users-branch"
                value="اختر مدرسة أولًا لعرض فروعها"
                disabled
                aria-describedby="users-branch-hint"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="users-status">حالة الحساب</Label>
            <Select
              value={current.status}
              onValueChange={(value) => applyParam("status", value)}
            >
              <SelectTrigger id="users-status" className={selectClass}>
                <SelectValue placeholder="جميع الحالات" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">جميع الحالات</SelectItem>
                <SelectItem value="ACTIVE">نشط</SelectItem>
                <SelectItem value="INACTIVE">موقوف</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm">
            <Filter className="size-4" aria-hidden="true" />
            تطبيق البحث
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={resetFilters}>
            <RotateCcw className="size-4" aria-hidden="true" />
            إعادة التعيين
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}