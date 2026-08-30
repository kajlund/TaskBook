# Waymark

Waymark is a personal task manager for ordered flat and phased task collections. It uses a Lit/Vite frontend, a Web-standard Hono API, PostgreSQL, Drizzle ORM, shared Zod contracts, and npm workspaces.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Docker Desktop (Windows) or Docker Engine with Compose (Linux)

## Start locally

Copy `.env.example` to `.env`, then run:

```bash
npm install
npm run db:start
npm run db:migrate
npm run db:seed
npm run dev
```

The web app is served at `http://localhost:5173`; the API health endpoint is `http://localhost:3000/api/health`.

On Windows, run the same commands from PowerShell. On Linux, run them from your preferred shell. If Docker requires elevated access on Linux, configure Docker for your user rather than running the application itself as root.

## Quality checks

```bash
npm test
npm run typecheck
npm run build
```

Database schema changes are generated with `npm run db:generate -w @waymark/api` and applied with `npm run db:migrate`.

## Architecture

- `apps/api`: Node entry point, Hono application, services, persistence, migrations, and seeds
- `apps/web`: Lit components, application state, API access, styles, and icons
- `packages/contracts`: shared request/response validation only; database models remain private to the API
- `docs/design`: approved visual references

Ordering uses persisted integer positions and transactional resequencing. Phase completion, collection progress, blocking, and waiting are derived rather than stored. Authentication, collaboration, milestones, and unrelated cross-collection moves are intentionally outside version one.
