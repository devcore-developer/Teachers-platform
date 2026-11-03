/* ------------------------------------------------------------------ */
/* Training academy — canonical keys, Arabic labels and server limits.  */
/*                                                                      */
/* SQLite has no native enums, so categories/levels/statuses/lesson     */
/* types are canonical English keys validated with Zod on every write;  */
/* Arabic labels here are UI-only and never persisted.                  */
/* ------------------------------------------------------------------ */

/** Canonical training categories (persisted in program/course rows). */
export const TRAINING_CATEGORIES = [
  "pedagogy",
  "curriculum",
  "technology",
  "classroom",
  "assessment",
  "inclusion",
  "safety",
  "growth",
] as const;

export type TrainingCategory = (typeof TRAINING_CATEGORIES)[number];

/** Arabic labels for the canonical category keys (UI only). */
export const TRAINING_CATEGORY_LABELS: Record<TrainingCategory, string> = {
  pedagogy: "طرق التدريس والاستراتيجيات",
  curriculum: "المناهج وتصميم التعلم",
  technology: "التقنية التعليمية",
  classroom: "إدارة الصف والبيئة الصفية",
  assessment: "التقويم وقياس الأثر",
  inclusion: "التربية الشاملة",
  safety: "السلامة والأمن المدرسي",
  growth: "النمو المهني والقيادة",
};

export function trainingCategoryLabel(category: string): string {
  return TRAINING_CATEGORY_LABELS[category as TrainingCategory] ?? category;
}

/** Optional course difficulty levels. */
export const COURSE_LEVELS = ["BEGINNER", "INTERMEDIATE", "ADVANCED"] as const;

export type CourseLevel = (typeof COURSE_LEVELS)[number];

export const COURSE_LEVEL_LABELS: Record<CourseLevel, string> = {
  BEGINNER: "مبتدئ",
  INTERMEDIATE: "متوسط",
  ADVANCED: "متقدم",
};

export function courseLevelLabel(level: string | null | undefined): string | null {
  if (!level) return null;
  return COURSE_LEVEL_LABELS[level as CourseLevel] ?? null;
}

/** Shared content lifecycle: programs and courses. */
export const CONTENT_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;

export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const CONTENT_STATUS_LABELS: Record<ContentStatus, string> = {
  DRAFT: "مسودة",
  PUBLISHED: "منشور",
  ARCHIVED: "مؤرشف",
};

export function contentStatusLabel(status: string): string {
  return CONTENT_STATUS_LABELS[status as ContentStatus] ?? status;
}

/** Lesson content types. */
export const LESSON_TYPES = [
  "TEXT",
  "VIDEO",
  "EXTERNAL_VIDEO",
  "RESOURCE",
] as const;

export type LessonType = (typeof LESSON_TYPES)[number];

export const LESSON_TYPE_LABELS: Record<LessonType, string> = {
  TEXT: "نص مطبوع",
  VIDEO: "فيديو مرفوع",
  EXTERNAL_VIDEO: "فيديو خارجي",
  RESOURCE: "مورد قابل للتنزيل",
};

export function lessonTypeLabel(type: string): string {
  return LESSON_TYPE_LABELS[type as LessonType] ?? type;
}

/**
 * Hosts allowed for EXTERNAL_VIDEO lessons. Embedding is restricted to
 * this allow-list — arbitrary server-side fetching never happens.
 */
export const EXTERNAL_VIDEO_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "vimeo.com",
  "player.vimeo.com",
] as const;

/** Attachment kinds (persisted canonical keys). */
export const ATTACHMENT_KINDS = ["COVER", "RESOURCE"] as const;

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/* ------------------------------------------------------------------ */
/* Upload limits — enforced on the SERVER in validateUpload().          */
/* ------------------------------------------------------------------ */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB — covers
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024; // 25 MB — resources
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB — uploaded videos

export const ALLOWED_IMAGE_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const ALLOWED_DOCUMENT_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;

export const ALLOWED_VIDEO_MIME = ["video/mp4", "video/webm"] as const;

/** Directory listing page size for course catalogs (cards grid). */
export const COURSES_PAGE_SIZE = 9;