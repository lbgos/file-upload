/**
 * On-disk layout: `<dataDir>/files/<id>/<name>` holds exactly one published file.
 * Uploads are written to `<dataDir>/tmp/<id>/` and renamed into place when complete.
 */
import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Transform, type Readable, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";

const FILE_ID = /^[a-f0-9]{32}$/u;
const MAX_FILENAME_LENGTH = 90;
const MAX_EXTENSION_LENGTH = 16;

export type StagedUpload = { id: string; name: string; tempDir: string };
export type StoredFile = { name: string; size: number; path: string };

export class UploadTooLargeError extends Error {}

/** Counts bytes and drops everything past the limit, so the request still drains and can get a 413. */
class ByteLimitStream extends Transform {
  exceeded = false;
  #received = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.#received += chunk.length;
    if (this.#received > this.maxBytes) this.exceeded = true;
    callback(null, this.exceeded ? undefined : chunk);
  }
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

/** Turns any client filename into an ASCII slug with a random suffix: `Login Flow.WEBM` -> `login-flow-1a2b3c4d.webm`. */
export function publicFilename(input: string): string {
  const dot = input.lastIndexOf(".");
  const extension = dot > 0 ? input.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/gu, "") : "";
  const hasExtension = extension.length > 0 && extension.length <= MAX_EXTENSION_LENGTH;
  const tail = `-${randomBytes(4).toString("hex")}${hasExtension ? `.${extension}` : ""}`;
  const stem = slug(hasExtension ? input.slice(0, dot) : input) || "file";
  return `${stem.slice(0, MAX_FILENAME_LENGTH - tail.length).replace(/-+$/u, "")}${tail}`;
}

export function isValidFileId(value: string): boolean {
  return FILE_ID.test(value);
}

function storagePaths(dataDir: string) {
  return { files: path.join(dataDir, "files"), temp: path.join(dataDir, "tmp") };
}

async function fsync(target: string): Promise<void> {
  const handle = await open(target, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Creates the storage directories and removes uploads interrupted by a previous crash. */
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
  stream: Readable,
  maxBytes: number,
): Promise<StagedUpload> {
  const id = randomBytes(16).toString("hex");
  const name = publicFilename(filename);
  const tempDir = path.join(storagePaths(dataDir).temp, id);
  const tempFile = path.join(tempDir, name);
  await mkdir(tempDir, { mode: 0o700 });

  try {
    const limiter = new ByteLimitStream(maxBytes);
    await pipeline(stream, limiter, createWriteStream(tempFile, { flags: "wx", mode: 0o640 }));
    if (limiter.exceeded) throw new UploadTooLargeError("File exceeds MAX_FILE_BYTES");
    await fsync(tempFile);
    return { id, name, tempDir };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

export async function publishUpload(dataDir: string, upload: StagedUpload): Promise<void> {
  const { files } = storagePaths(dataDir);
  await rename(upload.tempDir, path.join(files, upload.id));
  await fsync(files);
}

/** Returns the stored file only when `name` matches the one entry in its directory exactly. */
export async function findFile(dataDir: string, id: string, name: string): Promise<StoredFile | undefined> {
  if (!isValidFileId(id)) return undefined;
  const directory = path.join(storagePaths(dataDir).files, id);
  try {
    const [stored] = await readdir(directory);
    if (stored !== name) return undefined;
    const filePath = path.join(directory, stored);
    const info = await stat(filePath);
    return info.isFile() ? { name, size: info.size, path: filePath } : undefined;
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

export function openFileStream(file: StoredFile, range?: { start: number; end: number }) {
  return createReadStream(file.path, range);
}
