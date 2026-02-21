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

## Development

```bash
# Install dependencies
npm install

# Run local development server (with local D1)
npm run dev
# Runs on http://localhost:8787

# Generate database migrations from schema changes
npm run db:generate

# Apply migrations to local D1
npx wrangler d1 migrations apply DB --local

# Apply migrations to production D1
npx wrangler d1 migrations apply DB --remote
```

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
- quran-public (Nuxt frontend)
- quran-admin (Vue admin panel)
