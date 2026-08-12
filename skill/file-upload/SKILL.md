---
name: file-upload
description: When the user asks to upload a file, or one is needed for a PR description or handoff, use this skill.
---

# File upload

Upload files to `https://files.lbgos.dev` and return the permanent public URL from the response body. Authenticate with `FILE_HOST_TOKEN`. If it is unset, tell the user instead of guessing.

## Upload

```bash
curl -sS --fail-with-body -X PUT -T <path-to-file> \
  -H "X-Upload-Token: $FILE_HOST_TOKEN" \
  "https://files.lbgos.dev/<filename>"
```

- Use only the file's URL-encoded basename for `<filename>`, such as `login-flow.mp4`. The server slugifies it and adds a random suffix, so names do not need to be unique.
- Treat the response body as the permanent public URL and use it directly.
- Files are public to anyone with the URL. Inspect the file first and do not upload secrets, credentials, private configuration, real target data, or sensitive logs. Offer a redacted derivative when needed.
- On HTTP 401, report that the token is wrong or unset. Do not retry.
- Do not retry automatically after an ambiguous network failure because the first upload may have succeeded.

## Use the URL in GitHub

- Embed images (`png`, `jpg`, `jpeg`, `gif`, `webp`) as `![description](URL)`.
- Link videos (`mp4`, `mov`, `webm`) as `[screen recording](URL)` because GitHub does not inline-play externally hosted video.
- When an inline preview genuinely helps and the clip is shorter than about 30 seconds, also upload a GIF preview. Embed the GIF and link the full-quality video below it.
