#!/usr/bin/env node
/* ------------------------------------------------------------------ */
/* apply-r2-cors.mjs — one-time (idempotent) setup of the R2 bucket    */
/* CORS policy required for DIRECT browser uploads.                    */
/*                                                                     */
/* Why: the app uploads media with presigned PUT URLs via XHR          */
/* (src/components/media/media-input.tsx). A cross-origin XHR PUT      */
/* always triggers an OPTIONS preflight, and a bucket WITHOUT a CORS   */
/* policy answers it with no Access-Control-Allow-Origin header — the  */
/* browser then blocks the upload ("blocked by CORS policy").          */
/*                                                                     */
/* Usage (from the project root):                                      */
/*   node scripts/apply-r2-cors.mjs                                    */
/*                                                                     */
/* Credentials are read from the project .env (same lookup order as    */
/* the Prisma CLI — existing process env always wins):                 */
/*   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,            */
/*   R2_BUCKET_NAME                                                    */
/*                                                                     */
/* PutBucketCors REPLACES the whole policy, so re-running is safe.     */
/* NOTE: the R2 API token must have "Admin Read & Write" permission    */
/* (object-only tokens cannot change bucket settings).                 */
/* ------------------------------------------------------------------ */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/* ------------------------------ env ------------------------------- */

function stripQuotes(value) {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** Minimal .env loader (project root, then prisma/.env — like Prisma). */
function loadEnvFiles() {
  const candidates = [
    join(process.cwd(), ".env"),
    join(process.cwd(), "prisma", ".env"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf-8").split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      if (!process.env[match[1]]) {
        process.env[match[1]] = stripQuotes(match[2]);
      }
    }
  }
}

/* --------------------------- CORS policy -------------------------- */

/* Keep this list in sync with the deployment origins:
 *  - the production Vercel domain (exact match);
 *  - *.vercel.app covers preview deployments (one wildcard is allowed);
 *  - the local development server (add more ports if you use them). */
const ALLOWED_ORIGINS = [
  "https://edu-teachingplatform.vercel.app",
  "https://*.vercel.app",
  "http://localhost:3000",
];

const CORS_RULES = [
  {
    AllowedOrigins: ALLOWED_ORIGINS,
    AllowedMethods: ["GET", "PUT", "HEAD"],
    // The upload XHR sets only Content-Type; "*" also covers future headers.
    AllowedHeaders: ["*"],
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3600,
  },
];

/* ------------------------------ main ------------------------------ */

async function main() {
  loadEnvFiles();

  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET_NAME?.trim();

  const missing = Object.entries({
    R2_ACCOUNT_ID: accountId,
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
    R2_BUCKET_NAME: bucket,
  })
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    console.error(`Missing R2 environment variables: ${missing.join(", ")}`);
    console.error(
      "Fill them in the project .env (the same values you set on Vercel), then re-run:"
    );
    console.error("  node scripts/apply-r2-cors.mjs");
    console.error(
      "Alternatively paste the policy in the dashboard: R2 -> bucket -> Settings -> CORS policy."
    );
    process.exitCode = 1;
    return;
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    // Match src/lib/media/r2.ts — never sign checksums R2 rejects.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  console.log(`Bucket: ${bucket}`);
  console.log("Policy to apply:");
  console.log(JSON.stringify(CORS_RULES, null, 2));

  // Show the current policy (a fresh bucket has none).
  try {
    const current = await s3.send(
      new GetBucketCorsCommand({ Bucket: bucket })
    );
    console.log("Current CORS rules:");
    console.log(JSON.stringify(current.CORSRules ?? [], null, 2));
  } catch (error) {
    if (error?.name === "NoSuchCORSConfiguration") {
      console.log("Current CORS rules: none (fresh bucket)");
    } else {
      console.log(
        `Could not read the current policy (${error?.name ?? "unknown"}); continuing with the apply…`
      );
    }
  }

  try {
    await s3.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: { CORSRules: CORS_RULES },
      })
    );
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (error?.name === "AccessDenied" || status === 403) {
      console.error("AccessDenied — this R2 API token cannot change bucket settings.");
      console.error(
        'Create a token with "Admin Read & Write" permission and update R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY,'
      );
      console.error(
        "or paste the policy in the Cloudflare dashboard: R2 -> bucket -> Settings -> CORS policy."
      );
    }
    throw error;
  }

  // Verify by reading back.
  const after = await s3.send(new GetBucketCorsCommand({ Bucket: bucket }));
  console.log("Applied. Rules now on the bucket:");
  console.log(JSON.stringify(after.CORSRules ?? [], null, 2));
  console.log("Done — browser uploads work immediately (no redeploy needed).");
}

main().catch((error) => {
  console.error("FAILED:", error?.message ?? error);
  process.exitCode = 1;
});