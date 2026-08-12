import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.js";

test("requires a file host token", () => {
  assert.throws(() => loadConfig({}), /FILE_HOST_TOKEN/);
});

test("loads safe defaults and normalizes the public URL", () => {
  const config = loadConfig({
    FILE_HOST_TOKEN: "a-long-development-token",
    PUBLIC_BASE_URL: "https://files.lbgos.dev/",
  });

  assert.equal(config.maxFileBytes, 90 * 1024 * 1024);
  assert.equal(config.publicBaseUrl, "https://files.lbgos.dev");
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 3000);
});

test("rejects malformed limits and public URLs", () => {
  assert.throws(
    () => loadConfig({ FILE_HOST_TOKEN: "token", MAX_FILE_BYTES: "0" }),
    /MAX_FILE_BYTES/,
  );
  assert.throws(
    () => loadConfig({ FILE_HOST_TOKEN: "token", PUBLIC_BASE_URL: "javascript:alert(1)" }),
    /PUBLIC_BASE_URL/,
  );
});

test("requires an explicit public origin in production", () => {
  assert.throws(
    () => loadConfig({ FILE_HOST_TOKEN: "token", NODE_ENV: "production" }),
    /PUBLIC_BASE_URL/,
  );
});
