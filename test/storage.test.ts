import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { isValidFileId, prepareStorage, publicFilename, sanitizeFilename } from "../src/storage.js";

test("sanitizes traversal, control characters, and separators", () => {
  const name = sanitizeFilename("../folder\\evil\r\nX-Evil: 1.txt");

  assert.equal(name.includes("/"), false);
  assert.equal(name.includes("\\"), false);
  assert.equal(/[\r\n]/u.test(name), false);
  assert.match(name, /evil/u);
  assert.match(name, /\.txt$/u);
});

test("normalizes unicode and supplies a fallback filename", () => {
  assert.equal(sanitizeFilename("cafe\u0301.txt"), "caf\u00e9.txt");
  assert.equal(sanitizeFilename("../../"), "file");
});

test("bounds filename length without losing the extension", () => {
  const name = sanitizeFilename(`${"a".repeat(400)}.webm`);

  assert.ok(Buffer.byteLength(name) <= 90);
  assert.match(name, /\.webm$/u);
});

test("accepts only 128-bit lowercase hex ids", () => {
  assert.equal(isValidFileId("a".repeat(32)), true);
  assert.equal(isValidFileId("A".repeat(32)), false);
  assert.equal(isValidFileId("a".repeat(31)), false);
  assert.equal(isValidFileId("../"), false);
});

test("creates a slugged public filename with a random suffix", () => {
  const first = publicFilename("Login Flow FINAL!.WEBM");
  const second = publicFilename("Login Flow FINAL!.WEBM");

  assert.match(first, /^login-flow-final-[a-f0-9]{8}\.webm$/u);
  assert.notEqual(first, second);
});

test("cleans only app-shaped stale temporary directories on startup", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "file-upload-storage-"));
  await mkdir(path.join(dataDir, "tmp", "a".repeat(32)), { recursive: true });
  await mkdir(path.join(dataDir, "tmp", "unrelated"), { recursive: true });

  await prepareStorage(dataDir);

  assert.deepEqual(await readdir(path.join(dataDir, "tmp")), ["unrelated"]);
});
