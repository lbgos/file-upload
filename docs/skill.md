# Install the file-upload skill

Copy the skill into the Codex skills directory:

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R skill/file-upload "${CODEX_HOME:-$HOME/.codex}/skills/file-upload"
```

Configure the host and token in the environment used to start Codex:

```bash
export FILE_HOST_TOKEN='<production token>'
```

Do not commit the token to the skill or shell configuration stored in a public repository. Prefer the secret-injection mechanism used by the machine or agent harness.

Validate the client directly:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/file-upload/scripts/upload-file.mjs" \
  /absolute/path/to/safe-test-file.txt
```

The command uploads to `https://files.lbgos.dev` and prints one public URL on stdout. It never retries an ambiguous upload automatically because the first request may already have succeeded.
