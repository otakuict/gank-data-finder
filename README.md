# Gank Post Finder

A local full-stack search tool for public Gank seller posts and catalog listings. The Go/Gin backend resolves seller nicknames, paginates Gank API responses, caches them briefly, and handles all filtering/ranking so the React frontend never calls Gank directly.

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- Go 1.24 or newer

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
