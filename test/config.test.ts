import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.js";

test("requires a file host token", () => {
  assert.throws(() => loadConfig({}), /FILE_HOST_TOKEN/);
});

test("loads safe defaults", () => {
  const config = loadConfig({ FILE_HOST_TOKEN: "a-long-development-token" });

  assert.equal(config.maxFileBytes, 90 * 1024 * 1024);
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 3000);
});

test("rejects malformed limits", () => {
  assert.throws(
    () => loadConfig({ FILE_HOST_TOKEN: "token", MAX_FILE_BYTES: "0" }),
    /MAX_FILE_BYTES/,
  );
});
