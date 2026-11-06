-- Add Attachment.provider — storage backend discriminator.
-- Additive and non-destructive: every existing row keeps working and
-- is attributed to the legacy LOCAL (disk) backend.

ALTER TABLE "attachments" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'LOCAL';