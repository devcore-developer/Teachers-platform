"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ShieldOff } from "lucide-react";

import { setUserActiveAction } from "@/app/actions/users";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

/* ------------------------------------------------------------------ */
/* Account activation switch (management views). Presentation only —   */
/* the server re-validates scope, self-toggle and SUPER_ADMIN rows.    */
/* Deactivation revokes live sessions immediately (tokenVersion).      */
/* ------------------------------------------------------------------ */

interface UserStatusToggleProps {
  userId: string;
  userName: string;
  isActive: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

export function UserStatusToggle({
  userId,
  userName,
  isActive,
  disabled,
  disabledReason,
}: UserStatusToggleProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);

  async function handleToggle(checked: boolean) {
    setPending(true);
    const result = await setUserActiveAction(userId, checked);
    setPending(false);
    toast({
      title: result.ok ? "تم تحديث الحالة" : "تعذر تحديث الحالة",
      description: result.message,
      variant: result.ok ? "default" : "destructive",
    });
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Switch
        checked={isActive}
        disabled={disabled || pending}
        onCheckedChange={handleToggle}
        aria-label={`حالة حساب ${userName}`}
      />
      {disabled && (
        <ShieldOff
          className="size-3.5 text-muted-foreground/60"
          aria-hidden="true"
        />
      )}
      {disabled && disabledReason && (
        <span className="sr-only">{disabledReason}</span>
      )}
    </span>
  );
}