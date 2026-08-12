#!/usr/bin/env node

import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

function fail(message) {
  process.stderr.write(`file-upload: ${message}\n`);
  process.exitCode = 1;
}

const [fileArgument, ...extras] = process.argv.slice(2);
if (!fileArgument || extras.length) {
  fail("usage: upload-file.mjs /absolute/path/to/file");
} else {
  const token = process.env.FILE_HOST_TOKEN?.trim();
  const host = process.env.FILE_HOST_URL?.trim() || "https://files.lbgos.dev";

  if (!token) {
    fail("FILE_HOST_TOKEN is required");
  } else {
    try {
      const filePath = path.resolve(fileArgument);
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error("path is not a regular file");

      const origin = new URL(host);
      if (origin.protocol !== "http:" && origin.protocol !== "https:") {
        throw new Error("FILE_HOST_URL must use http or https");
      }
      const filename = encodeURIComponent(path.basename(filePath));
      const response = await fetch(new URL(`/${filename}`, origin), {
        method: "PUT",
        headers: { "X-Upload-Token": token },
        body: await openAsBlob(filePath),
        signal: AbortSignal.timeout(120_000),
      });

      const text = await response.text();
      if (!response.ok) {
        let message = `host returned ${response.status}`;
        try { message = JSON.parse(text)?.error?.message || message; } catch {}
        throw new Error(message);
      }
      const publicUrl = text.trim();
      if (!/^https?:\/\//u.test(publicUrl)) {
        throw new Error("host response did not contain a valid public URL");
      }
      process.stdout.write(`${publicUrl}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "upload failed";
      fail(message);
    }
  }
}
