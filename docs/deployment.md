# Deploy at files.lbgos.dev

## 1. Configure the host

Copy the project to the Docker host, then create the runtime environment:

```bash
cp .env.example .env
openssl rand -hex 32
chmod 600 .env
```

Put the generated value in `FILE_HOST_TOKEN`. Keep these production values:

```dotenv
PUBLIC_BASE_URL=https://files.lbgos.dev
MAX_FILE_BYTES=94371840
PORT=3000
```

The default is 90 MiB so the raw upload request stays below the 100 MB request limit on Cloudflare Free and Pro. Cloudflare plan limits can change or be reduced in the zone settings; verify the current value in [Cloudflare's 413 documentation](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-413/).

Start the service:

```bash
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:3000/healthz
```

### Native systemd service

For a native Node deployment on the current host, install the included unit after building:

```bash
pnpm install --frozen-lockfile
pnpm build
install -m 0644 deploy/file-upload.service /etc/systemd/system/file-upload.service
systemctl daemon-reload
systemctl enable --now file-upload.service
systemctl status file-upload.service --no-pager
```

The unit reads `/root/file-upload/.env`, stores uploads in `/root/file-upload/data`, listens on port `3000`, and restarts automatically after failures and reboots.

Allow port 3000 only from the Nginx Proxy Manager host or trusted LAN. Do not expose the origin port directly to the internet.

## 2. Configure Nginx Proxy Manager

Create a Proxy Host:

- Domain: `files.lbgos.dev`
- Scheme: `http`
- Forward host: the file-upload Docker host
- Forward port: `3000`
- Enable `Block Common Exploits`
- Select the existing `*.lbgos.dev` certificate
- Enable `Force SSL`

Add this to **Advanced → Custom Nginx Configuration**:

```nginx
client_max_body_size 95m;
proxy_request_buffering off;
proxy_read_timeout 300s;
proxy_send_timeout 300s;
```

The Nginx limit must stay above `MAX_FILE_BYTES` plus HTTP overhead and below the active Cloudflare limit.

## 3. Configure Cloudflare

The wildcard `*.lbgos.dev` record already routes through Cloudflare, so no separate DNS record is required when that wildcard remains active. Keep the record proxied and verify that the zone's Network → Maximum Upload Size is at least 100 MB.

Do not cache:

- `/api/*`
- `/healthz`
- `/`

Public `/f/*` responses are immutable and may be cached. Deletion removes the origin object but a cached copy can remain until Cloudflare expires or purges it. For immediate deletion semantics, create a Cache Rule that bypasses cache for `/f/*`; this is the safer initial setting.

## 4. Verify through the public path

Use a synthetic file with no secrets:

```bash
printf 'file-upload deployment check\n' > /tmp/file-upload-deployment-check.txt
curl --fail-with-body \
  -X PUT -T /tmp/file-upload-deployment-check.txt \
  -H "X-Upload-Token: $FILE_HOST_TOKEN" \
  https://files.lbgos.dev/file-upload-deployment-check.txt
```

Open the returned URL, verify its bytes, then delete it through the API. Also test one recording near the expected real-world size; local tests cannot prove Cloudflare and Nginx limits.

## Operations

View logs and health:

```bash
docker compose logs --tail=100 file-upload
docker compose ps
curl --fail http://127.0.0.1:3000/healthz
```

Upgrade:

```bash
docker compose build --pull
docker compose up -d
```

The named volume `file-upload-data` contains all published files. Back it up before moving hosts or removing the Compose project. Do not run `docker compose down -v` unless permanent deletion of every upload is intended.
