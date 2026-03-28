# @open-quran/api

REST API for the Open Thai Quran Project — community-driven Quran translation correction for Thai readers.

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Framework**: Hono
- **Database**: Cloudflare D1 (SQLite)
- **Cache**: Cloudflare KV
- **ORM**: Drizzle ORM
- **Auth**: JWT (hono/jwt)

## Database Schema

9 tables including:

- `quran_translations` - Arabic verse text
- `translation_sources` - Named translation sources
- `verse_translations` - Per-source Thai translations
- `translation_footnotes` - Footnotes for verses
- `contributors` - Contributor accounts with PBKDF2 password hashing
- `contributions` - Proposed translation edits
- `issue_reports` - Anonymous error flags
- `word_translations` - Per-word Thai meanings
- `changelog` - History of approved changes

## Quick Start for Contributors

```bash
# 1. Install dependencies
npm install

# 2. Apply migrations to local D1 database
npm run db:migrate:local

# 3. Seed with sample data (optional but recommended)
npm run db:seed

# 4. Start development server
npm run dev
# API: http://localhost:8787
# Swagger UI: http://localhost:8787/ui
```

**Test credentials** (after seeding):

- Email: `admin@local.dev`
- Password: `password123`

## Development

```bash
# Run local development server (with local D1)
npm run dev

# Generate database migrations from schema changes
npm run db:generate

# Apply migrations to local D1
npx wrangler d1 migrations apply DB --local

# Reset local database (clear, migrate, seed)
npm run db:reset

# Run quality checks
npm run lint
npm run typecheck
```

📖 **Full contributor guide**: See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed documentation on local development, testing, and contribution workflow.

## Deployment

Automatically deployed to Cloudflare Workers via GitHub Actions on push to `main`.

**Required Secrets:**

- `CLOUDFLARE_API_TOKEN` - Cloudflare API token
- `CLOUDFLARE_ACCOUNT_ID` - Your Cloudflare account ID

**Manual deployment:**

```bash
npm run deploy
```

## API Documentation

- OpenAPI spec: `http://localhost:8787/doc`
- Swagger UI: `http://localhost:8787/ui`

## Authentication

- 7-day JWT expiry
- PBKDF2 password hashing (via Web Crypto API)
- Routes protected by `requireAuth` / `requireAdmin` middleware

## CORS

Configured to allow requests from:

- quran-web (Quran frontend)
- quran-contributor (Translation Contributor tool)
