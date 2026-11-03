import bcrypt from "bcryptjs";

/* ------------------------------------------------------------------ */
/* Password hashing — bcrypt via bcryptjs (pure JS: no native build     */
/* steps on Windows/local machines). Plaintext passwords are never      */
/* stored, logged or embedded in URLs.                                  */
/* ------------------------------------------------------------------ */

const BCRYPT_COST = 12;

/** A fixed bcrypt hash of an unreachable random string. Compared against
 * when the account does not exist so that "user not found" and "wrong
 * password" take the same wall-clock time (timing-equalized login). */
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.5bTzDcZZowT8mSD2Fz.CbA9O7eO8fZu";

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Timing-equalizing no-op comparison for unknown accounts. */
export function verifyDummyPassword(plain: string): Promise<boolean> {
  return bcrypt.compare(plain, DUMMY_HASH);
}