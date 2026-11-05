
import { db } from "@/lib/db";

/* ------------------------------------------------------------------ */
/* Certificate signatory resolution (Part 3).                           */
/*                                                                      */
/* The responsible school signatory is the SCHOOL_MANAGER user of the   */
/* ISSUING school. Resolution is server-side and derived purely from    */
/* the school relationship — never from client input, never hardcoded,  */
/* and never a silent fallback to another role.                         */
/*                                                                      */
/* Callers (issue flow, certificate sheet) snapshot the returned name   */
/* onto the certificate at ISSUANCE time, so historical certificates    */
/* never change when the manager account is renamed or replaced.        */
/* ------------------------------------------------------------------ */

/** Official Arabic title printed beneath the signatory name. */
export const SCHOOL_SIGNATORY_TITLE = "مدير المدرسة";

export interface SchoolSignatory {
  /** The SCHOOL_MANAGER user the snapshot was taken from. */
  userId: string;
  /** Official display name at resolution time. */
  name: string;
  /** Always «مدير المدرسة». */
  title: string;
}

/**
 * Resolve the active School Manager of a school. Deterministic: when a
 * school ever has more than one active manager, the EARLIEST-CREATED
 * active account is the official signatory (stable ordering, no surprises).
 *
 * Returns null when the school has none — the issue flow must surface
 * an administrative warning and block issuance of certificates that
 * require the school signature (no fabricated names, no silent fallback).
 */
export async function resolveSchoolSignatory(
  schoolId: string
): Promise<SchoolSignatory | null> {
  if (!schoolId) return null;

  const manager = await db.user.findFirst({
    where: { role: "SCHOOL_MANAGER", schoolId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });

  if (!manager) return null;
  return { userId: manager.id, name: manager.name, title: SCHOOL_SIGNATORY_TITLE };
}