import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createApp } from "../src/server.js";

const TOKEN = "test-token-with-enough-entropy";

async function fixture(options: { maxFileBytes?: number; publicBaseUrl?: string | undefined } = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "file-upload-test-"));
  const app = await createApp({
    uploadToken: TOKEN,
    maxFileBytes: options.maxFileBytes ?? 1024 * 1024,
    dataDir,
    publicBaseUrl: Object.hasOwn(options, "publicBaseUrl")
      ? options.publicBaseUrl
      : "https://files.lbgos.dev",
    host: "127.0.0.1",
    port: 0,
  });
  return { app, dataDir };
}

async function upload(
  app: Awaited<ReturnType<typeof createApp>>,
  filename: string,
  body: Buffer,
  token = TOKEN,
) {
  return app.inject({
    method: "PUT",
    url: `/${encodeURIComponent(filename)}`,
    headers: { "x-upload-token": token, "content-type": "application/octet-stream" },
    payload: body,
  });
}

test("returns the same 401 response for missing and wrong tokens", async (t) => {
  const { app } = await fixture();
  t.after(() => app.close());
  const missing = await app.inject({ method: "PUT", url: "/proof.txt", payload: "proof" });
  const wrong = await upload(app, "proof.txt", Buffer.from("proof"), "wrong");

  assert.equal(missing.statusCode, 401);
  assert.equal(wrong.statusCode, 401);
  assert.deepEqual(missing.json(), wrong.json());
});

test("uploads raw bytes and returns only a permanent public URL", async (t) => {
  const { app, dataDir } = await fixture();
  t.after(() => app.close());
  const bytes = Buffer.from([0, 1, 2, 127, 128, 254, 255]);
  const response = await upload(app, "Capture FINAL.bin", bytes);

  assert.equal(response.statusCode, 201);
  assert.equal(response.headers["content-type"], "text/plain; charset=utf-8");
  assert.match(
    response.body,
    /^https:\/\/files\.lbgos\.dev\/f\/[a-f0-9]{32}\/capture-final-[a-f0-9]{8}\.bin$/u,
  );
  const pathname = new URL(response.body).pathname;
  const publicResponse = await app.inject({ method: "GET", url: pathname });
  assert.deepEqual(publicResponse.rawPayload, bytes);
  assert.match(publicResponse.headers["content-security-policy"] ?? "", /sandbox/u);
  assert.equal(publicResponse.headers["x-content-type-options"], "nosniff");
  assert.deepEqual(await readdir(path.join(dataDir, "tmp")), []);
});

test("same-name uploads get distinct slug suffixes and ids", async (t) => {
  const { app } = await fixture();
  t.after(() => app.close());
  const responses = await Promise.all(
    Array.from({ length: 8 }, (_, index) => upload(app, "same name.txt", Buffer.from(String(index)))),
  );
  assert.equal(responses.every((response) => response.statusCode === 201), true);
  assert.equal(new Set(responses.map((response) => response.body)).size, responses.length);
  assert.equal(responses.every((response) => /same-name-[a-f0-9]{8}\.txt$/u.test(response.body)), true);
});

test("long upload names always produce a fetchable public URL", async (t) => {
  const { app } = await fixture();
  t.after(() => app.close());
  const response = await upload(app, `${"x".repeat(180)}.webm`, Buffer.from("video"));

  assert.equal(response.statusCode, 201);
  const publicName = decodeURIComponent(new URL(response.body).pathname.split("/").at(-1) ?? "");
  assert.ok(Buffer.byteLength(publicName) <= 90);
  assert.match(publicName, /-[a-f0-9]{8}\.webm$/u);
  const fetched = await app.inject({ method: "GET", url: new URL(response.body).pathname });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.body, "video");
});

test("rejects oversized uploads with no residue", async (t) => {
  const { app, dataDir } = await fixture({ maxFileBytes: 4 });
  t.after(() => app.close());
  const response = await upload(app, "large.bin", Buffer.from("12345"));

  assert.equal(response.statusCode, 413);
  assert.deepEqual(await readdir(path.join(dataDir, "tmp")), []);
  assert.deepEqual(await readdir(path.join(dataDir, "files")), []);
});

test("supports empty files, byte ranges, and HEAD", async (t) => {
  const { app } = await fixture();
  t.after(() => app.close());
  const empty = await upload(app, "empty.txt", Buffer.alloc(0));
  const video = await upload(app, "demo.webm", Buffer.from("0123456789"));
  const pathname = new URL(video.body).pathname;

  assert.equal(empty.statusCode, 201);
  assert.equal((await app.inject({ method: "GET", url: new URL(empty.body).pathname })).rawPayload.length, 0);
  const range = await app.inject({ method: "GET", url: pathname, headers: { range: "bytes=2-5" } });
  const suffix = await app.inject({ method: "GET", url: pathname, headers: { range: "bytes=-3" } });
  const head = await app.inject({ method: "HEAD", url: pathname });
  const invalid = await app.inject({ method: "GET", url: pathname, headers: { range: "bytes=20-30" } });

  assert.equal(range.statusCode, 206);
  assert.equal(range.body, "2345");
  assert.equal(suffix.body, "789");
  assert.equal(head.headers["content-length"], "10");
  assert.equal(head.rawPayload.length, 0);
  assert.equal(invalid.statusCode, 416);
});

test("deletes with X-Upload-Token and returns 404 on repeat", async (t) => {
  const { app } = await fixture();
  t.after(() => app.close());
  const created = await upload(app, "delete.txt", Buffer.from("bye"));
  const url = new URL(created.body);
  const id = url.pathname.split("/")[2];
  assert.ok(id);

  const denied = await app.inject({ method: "DELETE", url: `/api/files/${id}` });
  const deleted = await app.inject({
    method: "DELETE",
    url: `/api/files/${id}`,
    headers: { "x-upload-token": TOKEN },
  });
  const repeated = await app.inject({
    method: "DELETE",
    url: `/api/files/${id}`,
    headers: { "x-upload-token": TOKEN },
  });

  assert.equal(denied.statusCode, 401);
  assert.deepEqual(deleted.json(), { deleted: true });
  assert.equal(repeated.statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: url.pathname })).statusCode, 404);
});

test("uses proxy headers when explicit public base URL is absent", async (t) => {
  const { app } = await fixture({ publicBaseUrl: undefined });
  t.after(() => app.close());
  const response = await app.inject({
    method: "PUT",
    url: "/proxy.txt",
    headers: {
      "x-upload-token": TOKEN,
      "content-type": "application/octet-stream",
      host: "files.lbgos.dev",
      "x-forwarded-proto": "https",
    },
    payload: "ok",
  });
  assert.match(response.body, /^https:\/\/files\.lbgos\.dev\/f\//u);
});

test("rejects malformed filename encoding and serves health and UI", async (t) => {
  const { app } = await fixture();
  t.after(() => app.close());
  const malformed = await app.inject({
    method: "PUT",
    url: "/%E0%A4%A",
    headers: { "x-upload-token": TOKEN, "content-type": "application/octet-stream" },
    payload: "x",
  });
  const health = await app.inject({ method: "GET", url: "/healthz" });
  const page = await app.inject({ method: "GET", url: "/" });

  assert.equal(malformed.statusCode, 400);
  assert.deepEqual(health.json(), { ok: true });
  assert.match(page.body, /files\.lbgos\.dev/u);
  assert.match(page.body, /drop/u);
});
