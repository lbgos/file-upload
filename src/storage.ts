import { randomBytes } from "node:crypto";
import {
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

const FILE_ID = /^[a-f0-9]{32}$/u;
const MAX_FILENAME_BYTES = 90;

export type StagedUpload = {
  id: string;
  name: string;
  size: number;
  tempDir: string;
};

export type StoredFile = {
  id: string;
  name: string;
  size: number;
  path: string;
};

export class UploadTooLargeError extends Error {}

class ByteLimitStream extends Transform {
  exceeded = false;
  #received = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.#received += chunk.length;
    if (this.#received > this.maxBytes) {
      this.exceeded = true;
      callback();
      return;
    }
    callback(null, chunk);
  }
}

function truncateUtf8(value: string, maxBytes: number): string {
  let result = "";
  for (const character of value) {
    if (Buffer.byteLength(result + character) > maxBytes) break;
    result += character;
  }
  return result;
}

export function sanitizeFilename(input: string): string {
  const normalized = input
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .replace(/[\\/]+/gu, "-")
    .replace(/\s+/gu, " ")
    .replace(/^[-. ]+|[-. ]+$/gu, "");

  if (!normalized) return "file";
  if (Buffer.byteLength(normalized) <= MAX_FILENAME_BYTES) return normalized;

  const extensionIndex = normalized.lastIndexOf(".");
  const hasExtension = extensionIndex > 0 && normalized.length - extensionIndex <= 20;
  const extension = hasExtension ? normalized.slice(extensionIndex) : "";
  const stem = hasExtension ? normalized.slice(0, extensionIndex) : normalized;
  const available = MAX_FILENAME_BYTES - Buffer.byteLength(extension);
  return `${truncateUtf8(stem, available)}${extension}` || "file";
}

export function publicFilename(input: string): string {
  const safe = sanitizeFilename(input);
  const extensionIndex = safe.lastIndexOf(".");
  const hasExtension = extensionIndex > 0 && safe.length - extensionIndex <= 20;
  const rawStem = hasExtension ? safe.slice(0, extensionIndex) : safe;
  const extension = hasExtension
    ? safe.slice(extensionIndex).toLowerCase().replace(/[^.a-z0-9]/gu, "")
    : "";
  const stem = rawStem
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "file";
  const suffix = randomBytes(4).toString("hex");
  const availableStemBytes = MAX_FILENAME_BYTES - Buffer.byteLength(extension) - suffix.length - 1;
  return `${truncateUtf8(stem, availableStemBytes)}-${suffix}${extension}`;
}

export function isValidFileId(value: string): boolean {
  return FILE_ID.test(value);
}

export function storagePaths(dataDir: string) {
  return {
    files: path.join(dataDir, "files"),
    temp: path.join(dataDir, "tmp"),
  };
}

export async function prepareStorage(dataDir: string): Promise<void> {
  const paths = storagePaths(dataDir);
  await mkdir(paths.files, { recursive: true, mode: 0o750 });
  await mkdir(paths.temp, { recursive: true, mode: 0o750 });

  for (const entry of await readdir(paths.temp, { withFileTypes: true })) {
    if (entry.isDirectory() && isValidFileId(entry.name)) {
      await rm(path.join(paths.temp, entry.name), { recursive: true, force: true });
    }
  }
}

export async function stageUpload(
  dataDir: string,
  filename: string,
  stream: Readable & { truncated?: boolean },
  maxBytes: number,
): Promise<StagedUpload> {
  const paths = storagePaths(dataDir);
  const id = randomBytes(16).toString("hex");
  const name = publicFilename(filename);
  const tempDir = path.join(paths.temp, id);
  const tempFile = path.join(tempDir, name);
  await mkdir(tempDir, { mode: 0o700 });

  try {
    const limiter = new ByteLimitStream(maxBytes);
    await pipeline(stream, limiter, createWriteStream(tempFile, { flags: "wx", mode: 0o640 }));
    if (stream.truncated || limiter.exceeded) throw new UploadTooLargeError("File exceeds MAX_FILE_BYTES");

    const handle = await open(tempFile, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }

    const info = await stat(tempFile);
    return { id, name, size: info.size, tempDir };
  } catch (error) {
    if (!stream.destroyed) stream.resume();
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

export async function publishUpload(dataDir: string, upload: StagedUpload): Promise<void> {
  const { files } = storagePaths(dataDir);
  await rename(upload.tempDir, path.join(files, upload.id));
  const handle = await open(files, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function discardUpload(upload: StagedUpload | undefined): Promise<void> {
  if (upload) await rm(upload.tempDir, { recursive: true, force: true });
}

export async function findFile(
  dataDir: string,
  id: string,
  requestedName: string,
): Promise<StoredFile | undefined> {
  if (!isValidFileId(id) || sanitizeFilename(requestedName) !== requestedName) return undefined;
  const filePath = path.join(storagePaths(dataDir).files, id, requestedName);
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return undefined;
    return { id, name: requestedName, size: info.size, path: filePath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function deleteFile(dataDir: string, id: string): Promise<boolean> {
  if (!isValidFileId(id)) return false;
  const directory = path.join(storagePaths(dataDir).files, id);
  try {
    await stat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  await rm(directory, { recursive: true });
  return true;
}

export function openFileStream(file: StoredFile, start?: number, end?: number) {
  return createReadStream(file.path, start === undefined ? undefined : { start, end });
}
