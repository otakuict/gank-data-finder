# Gank Post Finder

A local full-stack search tool for public Gank seller posts and catalog listings. The Go/Gin backend resolves seller nicknames, paginates Gank API responses, caches them briefly, and handles all filtering/ranking so the React frontend never calls Gank directly.

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- Go 1.27 or newer (as required by `backend/go.mod`)

## Install and run

```bash
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. The API runs at **http://127.0.0.1:3001**.

On Windows, you can also double-click `run-app.bat` to install missing dependencies and start both services in one terminal window.

The development command safely stops stale instances from this workspace on ports `3001` and `5173` before starting. It will never terminate an unrelated process that happens to use either port.

Run the test suite and production build:

```bash
npm test
npm run build
```

To run the compiled API after building:

```bash
npm start
```

On Windows, the npm commands use `scripts/go-local.bat`, which prefers the workspace-local Go toolchain when present and otherwise uses `go.exe` from `PATH`.

## Production with Docker

Run these commands from the repository root with Docker running in Linux container mode:

```bash
docker build --pull -t gank-post-finder:production .
docker run -d --name gank-post-finder --restart unless-stopped -p 3001:3001 --read-only --cap-drop ALL --security-opt no-new-privileges:true gank-post-finder:production
```

Open **http://localhost:3001**. The image builds React and Go in separate stages,
runs the Go tests during the build, and serves the frontend and `/api` from one
Go process. The runtime runs as UID/GID `10001`, contains HTTPS CA certificates,
and checks `/api/health` every 30 seconds. Node.js and Go build tools are not
included in the runtime image. No server-side data volume is needed; saved
sellers remain in browser local storage.

`PORT` defaults to `3001`. If overriding it with `-e PORT=8080`, also change the
port mapping to `-p 8080:8080`. `STATIC_DIR` defaults to `/app/public` in the
image; outside Docker it is optional, so local API-only development still works.
Missing files and unknown API endpoints return 404. Place an HTTPS reverse
proxy in front of the container for a public deployment.

```bash
docker inspect --format '{{.State.Health.Status}}' gank-post-finder
docker logs -f gank-post-finder
docker stop gank-post-finder
```

## GitHub Actions deployment to an Ubuntu server

The workflow in `.github/workflows/cicd.yml` builds the production image on pull
requests to `main`. A push to `main` (or a manual run on `main`) logs in to
Docker Hub, pushes an image tagged with the commit SHA, and deploys it using a
**self-hosted GitHub Actions runner on the Ubuntu server**. The runner pulls the
image and starts it on port `3001`. The deployment waits for the Docker health
check; if it fails, the previous container is restored. GitHub does not need
SSH access to the server.

Prepare the Ubuntu server with Docker Engine and `bash`. Install a repository
self-hosted runner following [GitHub's runner setup instructions](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners),
and run it as a service. The runner
account must be able to run `docker` without `sudo`; for example, add a
dedicated runner account to the `docker` group and restart the runner service.
The server needs outbound access to GitHub and Docker Hub, plus enough free
space for the current and incoming image. Expose port `3001` or place an HTTPS
reverse proxy in front of it. Pull requests build on GitHub-hosted runners and
do not run on the production server.

The workflow publishes to `otakuict/gank-post-finder`. Add these values in
GitHub **Settings → Secrets and variables → Actions**:

| Type | Name | Value |
| --- | --- | --- |
| Variable | `DOCKERHUB_USERNAME` | Docker Hub username with push access |
| Secret | `DOCKERHUB_TOKEN` | Docker Hub access token with push and pull access |

The same token is used to pull private images on the server. The
[`docker/login-action`](https://github.com/docker/login-action) logs out at the
end of each job. After deployment, check the container on the server with
`docker ps` and `docker logs gank-post-finder`.

## API

`GET /api/search`

Example:

```text
/api/search?seller=loveshakedata&date=260827&name=chaewon&count=2075&source=both&includeInactive=true&mode=exact
```

Parameters: `seller` (required), `date` (six digits), `name`, `count` (positive integer), `source` (`posts`, `shop`, or `both`), `includeInactive` (`true`/`false`), and `mode` (`exact`/`broad`). At least one of date, name, or count is required. The frontend's **All shops** option runs this filtered shop search across every saved seller.

`GET /api/sellers/resolve?seller=loveshakedata` validates a public seller nickname and returns its resolved user ID before the frontend saves it to the local shop list.

Added seller nicknames are stored in the browser's local storage. **All shops** keeps the date, idol/name, and optional count filters active, then searches both feed posts and shop listings for every saved seller with live per-shop progress.

Only public API responses are used. Inactive pages and deleted previews may remain unavailable even when their public catalog metadata is searchable.
