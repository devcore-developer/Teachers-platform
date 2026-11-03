import Link from "next/link";
import { UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Local 404 for the user-details route (id does not exist). */
export default function UserNotFound() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-muted/40 px-6 py-14 text-center">
      <div
        className="mb-3 flex size-12 items-center justify-center rounded-full bg-brand-100 text-brand-700"
        aria-hidden="true"
      >
        <UserRound className="size-6" strokeWidth={1.8} />
      </div>
      <p className="text-sm font-bold">الحساب غير موجود</p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
        الرابط الذي فتحته يشير إلى حساب غير موجود أو خارج نطاق صلاحيتك.
      </p>
      <Button asChild size="sm" className="mt-4">
        <Link href="/users">العودة إلى دليل المستخدمين</Link>
      </Button>
    </div>
  );
}