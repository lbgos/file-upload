import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Browser sessions carry a value derived from the upload token, so rotating the token signs every browser out. */
export const SESSION_COOKIE = "fu_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function hasValidToken(value: string | undefined, expectedToken: string): boolean {
  if (!value) return false;
  return timingSafeEqual(digest(value), digest(expectedToken));
}

export function sessionValue(uploadToken: string): string {
  return createHmac("sha256", uploadToken).update("file-upload browser session v1").digest("base64url");
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator !== -1 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}
