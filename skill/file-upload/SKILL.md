---
name: file-upload
description: When the user asks to upload a file, or one is needed for a PR description or handoff, use this skill.
---

# File upload

Upload to `$FILE_HOST_URL` (default `https://files.lbgos.dev`). The response body is the permanent public URL.

```bash
[ -n "$FILE_HOST_TOKEN" ] || . ~/.config/file-upload.env
curl -sS --fail-with-body -X PUT -T <path-to-file> \
  -H "X-Upload-Token: $FILE_HOST_TOKEN" \
  "${FILE_HOST_URL:-https://files.lbgos.dev}/<url-encoded-basename>"
```

- If the token is still unset after sourcing `~/.config/file-upload.env`, tell the user. Never print the token.
- The server slugs the name and adds a random suffix, so names do not need to be unique.
- Files are public to anyone with the URL. Inspect the file first. Do not upload secrets, credentials, private configuration, real target data or sensitive logs; offer a redacted copy instead.
- On HTTP 401, report that the token is wrong. Do not retry.
- Do not retry after an ambiguous network failure; the first upload may have succeeded.
- Delete an upload with `curl -sS --fail-with-body -X DELETE -H "X-Upload-Token: $FILE_HOST_TOKEN" "${FILE_HOST_URL:-https://files.lbgos.dev}/api/files/<id>"`, where `<id>` is the 32-hex segment of the URL.

## Use the URL in GitHub

- Embed images (`png`, `jpg`, `jpeg`, `gif`, `webp`) as `![description](URL)`.
- Link videos (`mp4`, `mov`, `webm`) as `[screen recording](URL)`; GitHub does not inline-play externally hosted video.
- For clips under about 30 seconds where a preview helps, also upload a GIF, embed it, and link the full video below it.
