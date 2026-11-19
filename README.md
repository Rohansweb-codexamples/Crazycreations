# CrazyCreations

CrazyCreations is a pay-on-delivery online shop with a customer storefront, order tracking and a protected admin dashboard.

## Hosting on Vercel

This project is configured for **Vercel**. The root `server.js` exports the Express application, which Vercel deploys as one Function. Static files are in `public/`.

1. Import this GitHub repository into Vercel.
2. Keep the project root set to the repository root. Vercel should detect the Express app automatically.
3. Add a persistent PostgreSQL database using a Vercel Marketplace Postgres integration (for example, Neon).
4. Add the database connection string to Vercel as `DATABASE_URL` for Production (and Preview/Development if needed).
5. Add `SESSION_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` as Vercel environment variables.
6. Deploy. Database tables and sample products are created automatically on the first successful request when the database is empty.

Vercel's former Vercel Postgres product is no longer available for new projects; use a Postgres provider from the Marketplace. The database is separate from Vercel deployments, so redeploying the website does not erase products or orders. The database provider's own retention and backup settings still apply.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string from your database provider |
| `SESSION_SECRET` | Long random secret used to sign admin sessions |
| `ADMIN_EMAIL` | Email address for the first admin account |
| `ADMIN_PASSWORD` | Password for the first admin account |
| `NODE_ENV` | Set to `production` on Vercel |

The initial admin is inserted only if that email does not already exist. Changing `ADMIN_PASSWORD` later will not automatically change an existing admin's password.

## Store features

- Customer shop at `/`
- Admin dashboard at `/admin`
- Order tracking at `/track`
- Pay on delivery (no online card payments)
- Product, stock, order, delivery-status and delivery-fee management
- PostgreSQL-backed products, orders, admin accounts and sessions

## Local development

```bash
npm install
npm start
```

Set the environment variables above in your local environment before starting the server. The app listens on port 3000 by default.
