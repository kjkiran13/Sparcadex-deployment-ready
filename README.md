# Sparcadex Solutions — Deployment Ready

## Stack
- Node.js
- Express
- PostgreSQL / Supabase
- Nodemailer
- Static HTML frontend
- Protected admin dashboard

## Routes
- `/` — main website
- `/admin` — admin dashboard
- `/api/health` — health check
- `/api/contact` — contact form
- `/api/admin/inquiries` — protected inquiry API

## Local setup
1. Copy `.env.example` to `.env`.
2. Add `DATABASE_URL` and a strong `ADMIN_KEY`.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:4000`.

## Supabase
Run `supabase.sql` in the Supabase SQL Editor, then copy the database connection string into `DATABASE_URL`.

## Render
Create a Web Service from this GitHub repository.

Build command:
`npm install`

Start command:
`npm start`

Add these environment variables in Render:
- `ADMIN_KEY`
- `DATABASE_URL`
- `MAIL_HOST` (optional)
- `MAIL_PORT` (optional)
- `MAIL_USER` (optional)
- `MAIL_PASS` (optional)
- `MAIL_TO` (optional)

Do not commit `.env` or real credentials.
