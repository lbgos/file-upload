import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const script = path.resolve("skill/file-upload/scripts/upload-file.mjs");

async function runClient(
  file: string,
  environment: Record<string, string | undefined>,
  cwd?: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, file], {
      env: { ...process.env, ...environment },
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("skill client uploads a file and prints only the public URL", async (t) => {
  const token = "skill-test-secret-token";
  const directory = await mkdtemp(path.join(tmpdir(), "file-upload-skill-"));
  const file = path.join(directory, "proof.txt");
  await writeFile(file, "proof-body");

  const server = createServer((request, response) => {
    assert.equal(request.method, "PUT");
    assert.equal(request.url, "/proof.txt");
    assert.equal(request.headers["x-upload-token"], token);
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      assert.match(Buffer.concat(chunks).toString("utf8"), /proof-body/u);
      response.writeHead(201, { "content-type": "text/plain" });
      response.end("https://files.lbgos.dev/f/id/proof-a1b2c3d4.txt");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const result = await runClient(file, {
    FILE_HOST_URL: `http://127.0.0.1:${address.port}`,
    FILE_HOST_TOKEN: token,
  }, directory);

  assert.equal(result.code, 0);
  assert.equal(result.stdout, "https://files.lbgos.dev/f/id/proof-a1b2c3d4.txt\n");
  assert.equal(result.stderr.includes(token), false);
});

test("skill client fails clearly without configuration or a regular file", async () => {
  const missingToken = await runClient("/does/not/matter", {
    FILE_HOST_URL: "https://files.lbgos.dev",
    FILE_HOST_TOKEN: undefined,
  });
  const missingFile = await runClient("/does/not/exist", {
    FILE_HOST_URL: "https://files.lbgos.dev",
    FILE_HOST_TOKEN: "secret",
  });

  assert.equal(missingToken.code, 1);
  assert.match(missingToken.stderr, /FILE_HOST_TOKEN/u);
  assert.equal(missingFile.code, 1);
  assert.match(missingFile.stderr, /ENOENT/u);
});

test("skill client reports API errors without leaking its token", async (t) => {
  const token = "never-print-this-token";
  const directory = await mkdtemp(path.join(tmpdir(), "file-upload-skill-"));
  const file = path.join(directory, "proof.txt");
  await writeFile(file, "proof");
  const server = createServer((_request, response) => {
    response.writeHead(413, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "File exceeds the upload limit" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const result = await runClient(file, {
    FILE_HOST_URL: `http://127.0.0.1:${address.port}`,
    FILE_HOST_TOKEN: token,
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /upload limit/u);
  assert.equal(`${result.stdout}${result.stderr}`.includes(token), false);
});
