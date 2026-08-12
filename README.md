<p align="center">
  <strong>files.lbgos.dev</strong>
</p>

<p align="center">
  A small self-hosted place for screenshots, recordings, logs, and other files worth sharing.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="docs/deployment.md">Deployment</a> ·
  <a href="docs/skill.md">Codex Skill</a>
</p>

<p align="center">
  <img src="docs/ui-desktop.png" alt="files.lbgos.dev upload interface">
</p>

---

## Quick Start

Requires Docker and Docker Compose.

```bash
git clone <repository-url> file-upload
cd file-upload
cp .env.example .env
openssl rand -hex 32
```

Put the generated token in `.env`, then start the service:

```bash
docker compose up -d --build
```

Open `http://localhost:3000`, paste the upload token, and drop in a file.

Production setup for `files.lbgos.dev`, Cloudflare, and Nginx Proxy Manager lives in the [deployment guide](docs/deployment.md).

## How It Works

- Uploads require your private token.
- Files receive long, random public URLs.
- Anyone with a file URL can open or download it.
- Files are not listed or searchable through the service.
- The upload token stays in page memory and disappears on reload.
- Videos support seeking and partial downloads.
- Finished uploads can be copied, opened, or deleted from the page.

This is public link storage, not private file storage. Do not upload secrets, credentials, private configuration, or sensitive logs.

## Upload from the Terminal

```bash
export FILE_HOST_TOKEN='<your token>'

curl --fail-with-body -X PUT -T ./recording.webm \
  -H "X-Upload-Token: $FILE_HOST_TOKEN" \
  https://files.lbgos.dev/recording.webm
```

The response body is the permanent public URL:

```text
https://files.lbgos.dev/f/1e452850091a42cab2b47fe36691651b/recording-a1b2c3d4.webm
```

Delete it with:

```bash
curl --fail-with-body -X DELETE \
  -H "X-Upload-Token: $FILE_HOST_TOKEN" \
  https://files.lbgos.dev/api/files/1e452850091a42cab2b47fe36691651b
```

## Codex Skill

The included `file-upload` skill lets a coding agent upload a local artifact and return its public URL. It checks that the file is safe to share and never prints the upload token.

Installation and environment setup are in the [skill guide](docs/skill.md).

## Develop

Requires Node.js 24 and pnpm 10.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Run typechecking, tests, and the production build:

```bash
pnpm check
```

## License

MIT — see [LICENSE](LICENSE).
