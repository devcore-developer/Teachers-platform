/* ------------------------------------------------------------------ */
/* Media reference safety — orphan prevention.                          */
/*                                                                      */
/* Before an R2 object is deleted we count every database reference to  */
/* its stored URL. Only when the count reaches ZERO is the object       */
/* actually removed. Shared media (the same URL used by two schools or  */
/* two lessons) is therefore never destroyed by one side's edit.        */
/*                                                                      */
/* The list below must cover every URL-bearing media column. When a new */
/* media field is added to the schema, register it here — one line.     */
/* ------------------------------------------------------------------ */

import "server-only";

import { db } from "@/lib/db";

import { deleteObject, isManagedMediaUrl, keyFromManagedUrl } from "@/lib/media/r2";

/**
 * All references (across tenants) to an exact media URL.
 * Extend this function whenever a new media URL column is introduced.
 */
export async function countMediaReferences(url: string): Promise<number> {
  const [schools, lessons] = await Promise.all([
    db.school.count({ where: { logoUrl: url } }),
    db.courseLesson.count({ where: { videoUrl: url } }),
  ]);
  return schools + lessons;
}

export type ReleaseResult =
  | { released: true; deletedKey: string | null }
  | { released: false; reason: "EXTERNAL_URL" | "STILL_REFERENCED"; references: number };

/**
 * Called when a media URL is being replaced or cleared. Deletes the R2
 * object behind `url` ONLY when it is platform-managed AND no database
 * row references it anymore. External URLs pass through untouched, and
 * shared objects survive (caller keeps serving them).
 */
export async function releaseMediaIfUnreferenced(url: string | null | undefined): Promise<ReleaseResult> {
  if (!url || !isManagedMediaUrl(url)) {
    return { released: false, reason: "EXTERNAL_URL", references: 0 };
  }
  const references = await countMediaReferences(url);
  if (references > 0) {
    return { released: false, reason: "STILL_REFERENCED", references };
  }
  const key = keyFromManagedUrl(url);
  if (!key) return { released: false, reason: "EXTERNAL_URL", references: 0 };
  await deleteObject(key);
  return { released: true, deletedKey: key };
}