# Render Setup

## API service

- Name: `cableops-api`
- Runtime: `Node`
- Root directory: repo root
- Build command: `npm install`
- Start command: `npm run start:api`

## Static web service

- Name: `cableops-web`
- Type: `Static Site`
- Root directory: `apps/web`
- Publish directory: `.`

## Required environment variables

- `PORT`
- `CORS_ORIGIN`
- `DATABASE_URL`

## Notes

- The current frontend points to `https://cableops-api.onrender.com/api` by default when not running on localhost.
- For a real deployment, replace that host in `app.js` or inject `window.CABLEOPS_API_BASE` before the script loads.
- Login is now JWT-based with protected routes, logout, and password change flow.
- Current API business data is still mock/in-memory scaffold data. Next step is wiring Prisma + PostgreSQL + real CRUD persistence.
