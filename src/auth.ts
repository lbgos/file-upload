import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function hasValidToken(value: string | undefined, expectedToken: string): boolean {
  if (!value) return false;
  return timingSafeEqual(digest(value), digest(expectedToken));
}
