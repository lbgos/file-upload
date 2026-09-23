import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { isValidFileId, prepareStorage, publicFilename } from "../src/storage.js";

test("slugs separators, control characters, and unicode into a safe name", () => {
  assert.match(publicFilename("../folder\\evil\r\nX-Evil: 1.txt"), /^folder-evil-x-evil-1-[a-f0-9]{8}\.txt$/u);
  assert.match(publicFilename("Café Résumé.PDF"), /^cafe-resume-[a-f0-9]{8}\.pdf$/u);
  assert.match(publicFilename("../../"), /^file-[a-f0-9]{8}$/u);
  assert.match(publicFilename(".env"), /^env-[a-f0-9]{8}$/u);
});

test("bounds filename length without losing the extension", () => {
  const name = publicFilename(`${"a".repeat(400)}.webm`);

  assert.ok(name.length <= 90);
  assert.match(name, /-[a-f0-9]{8}\.webm$/u);
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
