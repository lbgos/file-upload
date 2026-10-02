import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createApp } from "../src/server.js";

const TOKEN = "test-token-with-enough-entropy";

async function fixture(options: { maxFileBytes?: number } = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "file-upload-test-"));
  const app = await createApp({
    uploadToken: TOKEN,
    maxFileBytes: options.maxFileBytes ?? 1024 * 1024,
    dataDir,
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
    headers: { "x-upload-token": token, host: "files.lbgos.dev", "x-forwarded-proto": "https" },
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

test("rejects path traversal in the public filename", async (t) => {
  const { app } = await fixture();
  t.after(() => app.close());
  const created = await upload(app, "secret.txt", Buffer.from("x"));
  const id = new URL(created.body).pathname.split("/")[2];

  const traversal = await app.inject({ method: "GET", url: `/f/${id}/..%2F..%2Ffiles` });
  assert.equal(traversal.statusCode, 404);
});

test("rejects malformed filename encoding and serves health", async (t) => {
  const { app } = await fixture();
  t.after(() => app.close());
  const malformed = await app.inject({
    method: "PUT",
    url: "/%E0%A4%A",
    headers: { "x-upload-token": TOKEN, "content-type": "application/octet-stream" },
    payload: "x",
  });
  const health = await app.inject({ method: "GET", url: "/healthz" });

  assert.equal(malformed.statusCode, 400);
  assert.deepEqual(health.json(), { ok: true });
});

test("browser session: only the token signs in, the cookie authorizes uploads and the upload page", async (t) => {
  const { app } = await fixture();
  t.after(() => app.close());
  const isUploadPage = (body: string) => body.includes('id="drop-zone"');

  const anonymous = await app.inject({ method: "GET", url: "/" });
  assert.equal(isUploadPage(anonymous.body), false);
  assert.match(anonymous.body, /id="sign-in"/u);
  assert.equal(anonymous.headers["cache-control"], "private, no-store");

  const forged = "fu_session=forged";
  assert.equal(isUploadPage((await app.inject({ method: "GET", url: "/", headers: { cookie: forged } })).body), false);
  const forgedUpload = await app.inject({ method: "PUT", url: "/x.txt", headers: { cookie: forged }, payload: "x" });
  assert.equal(forgedUpload.statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/api/session", headers: { "x-upload-token": "wrong" } })).statusCode, 401);

  const signIn = await app.inject({
    method: "POST",
    url: "/api/session",
    headers: { "x-upload-token": TOKEN, "x-forwarded-proto": "https" },
  });
  assert.equal(signIn.statusCode, 204);
  const setCookie = String(signIn.headers["set-cookie"]);
  assert.match(setCookie, /HttpOnly; SameSite=Lax; Secure$/u);
  assert.equal(setCookie.includes(TOKEN), false);
  const cookie = setCookie.split(";")[0] ?? "";

  assert.equal(isUploadPage((await app.inject({ method: "GET", url: "/", headers: { cookie } })).body), true);
  const uploaded = await app.inject({ method: "PUT", url: "/x.txt", headers: { cookie }, payload: "x" });
  assert.equal(uploaded.statusCode, 201);
  // A cookie alone cannot mint a new session.
  assert.equal((await app.inject({ method: "POST", url: "/api/session", headers: { cookie } })).statusCode, 401);

  const signOut = await app.inject({ method: "DELETE", url: "/api/session" });
  assert.match(String(signOut.headers["set-cookie"]), /^fu_session=; Path=\/; Max-Age=0;/u);
});
