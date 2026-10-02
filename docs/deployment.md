# Deployment

Production runs as a Docker container behind Nginx Proxy Manager (NPM) and Cloudflare.

## Service

```bash
cp .env.example .env && chmod 600 .env   # set FILE_HOST_TOKEN
docker compose up -d --build
curl --fail http://127.0.0.1:3000/healthz
```

`docker-compose.yml` publishes the port on `127.0.0.1` only. If the proxy runs in another container, attach both containers to a shared Docker network and drop the `ports` entry.

Uploads live in the `file-upload-data` volume, or wherever you mount `/data`. Back it up. `docker compose down -v` deletes every upload.

Upgrade with `docker compose up -d --build`.

## Reverse proxy

The proxy must forward `Host` and `X-Forwarded-Proto`. The server builds returned URLs from them. NPM does this by default.

NPM proxy host:

- Forward to `http://<container-or-host>:3000`.
- Enable Force SSL with a certificate for the domain.
- Leave Cache Assets off. It caches `/f/*.png`, `.svg` and similar for 30 minutes, ignores the app's `Cache-Control` and keeps serving a deleted file instead of the 404.
- Custom Nginx config when uploads are large or slow:

```nginx
client_max_body_size 95m;
proxy_request_buffering off;
proxy_read_timeout 300s;
proxy_send_timeout 300s;
```

## Cloudflare

Keep the DNS record proxied. Cloudflare Free and Pro reject request bodies over 100 MB, so keep `MAX_FILE_BYTES` below that. The default is 90 MiB.

`/f/*` responses carry `cache-control: public, max-age=300`. After a delete, Cloudflare can serve its cached copy for up to five minutes. Purge the URL or add a cache bypass rule for `/f/*` if deletes must take effect immediately.

## Check

```bash
printf 'deploy check\n' > /tmp/deploy-check.txt
url=$(curl -sS --fail-with-body -X PUT -T /tmp/deploy-check.txt \
  -H "X-Upload-Token: $FILE_HOST_TOKEN" https://files.example.com/deploy-check.txt)
curl -sS "$url"
curl -sS -X DELETE -H "X-Upload-Token: $FILE_HOST_TOKEN" \
  "https://files.example.com/api/files/$(echo "$url" | cut -d/ -f5)"
```
