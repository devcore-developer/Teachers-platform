-- Unified training creation + mandatory teacher journey.
-- STRICTLY ADDITIVE: every column is nullable / optional so existing
-- courses, assessments, attempts, certificates and survey responses
-- keep their exact meaning (null = legacy record, no behavior change).

ALTER TABLE "courses" ADD COLUMN "trainingType" TEXT;
ALTER TABLE "courses" ADD COLUMN "subcategory" TEXT;
ALTER TABLE "courses" ADD COLUMN "scheduledAt" TIMESTAMP(3);
ALTER TABLE "courses" ADD COLUMN "meetingUrl" TEXT;
ALTER TABLE "courses" ADD COLUMN "youtubeUrl" TEXT;
ALTER TABLE "courses" ADD COLUMN "supervisorInstructionsAr" TEXT;

ALTER TABLE "assessments" ADD COLUMN "passingPercent" INTEGER;