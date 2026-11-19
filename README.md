# CrazyCreations

A bright, responsive online shop with **pay on delivery only**, a private admin dashboard, shared orders and delivery tracking.

## Your data is stored in PostgreSQL — not on the Render server

The Node backend connects to a separate **Render PostgreSQL database** using \`DATABASE_URL\`.

- Products, prices, stock and product image URLs are stored in PostgreSQL.
- Customer orders, addresses, order items and delivery statuses are stored in PostgreSQL.
- Admin accounts and login sessions are stored securely using password hashes and PostgreSQL-backed sessions.
- The app does not rely on the web server's local files or memory for shop data.

**Restarting or redeploying the Render web service does not reset products or orders.** The database is a separate service, so it remains in place while the web service is rebuilt.

### Important: Render's free database has an expiry

The current \`render.yaml\` creates a **Free Render Postgres** database to make initial testing easier. Render's free Postgres databases expire 30 days after creation. After expiry, you have a 14-day grace period to upgrade before Render deletes the database and its data.

For a shop you intend to keep using, upgrade the database to a paid Render Postgres plan before that expiry, or connect another persistent PostgreSQL provider. Do not treat the free database as permanent storage. See [Render's free instance limits](https://render.com/docs/free).

## Deploy on Render

1. Open [Render](https://render.com) and choose **New → Blueprint**.
2. Connect the GitHub repository \`Rohansweb-codexamples/Crazycreations\`.
3. Render reads \`render.yaml\` and creates the Node web service and PostgreSQL database.
4. When prompted, set:
   - \`ADMIN_EMAIL\`: the email address you will use to sign into the admin area.
   - \`ADMIN_PASSWORD\`: a strong, unique password (at least 12 characters).
5. Deploy. The app automatically creates its database tables and initial admin account on first start.

## Pages

- \`/\` — customer shop, basket and checkout
- \`/track\` — order tracking
- \`/admin\` — private admin dashboard

## Payment

Checkout is **Pay on delivery**. No card payment provider is connected or requested.

## Shop management

- Add, edit and hide products from the Admin dashboard.
- Product images are managed using image URLs.
- Set the delivery fee in Admin → Settings.
- Orders can be confirmed, prepared, marked out for delivery, delivered or cancelled.
- Stock is checked and reduced in a database transaction when an order is placed.

## Security and backups

- Keep \`ADMIN_PASSWORD\`, \`SESSION_SECRET\` and \`DATABASE_URL\` private. Never put them in frontend files or commit them to GitHub.
- Customer addresses and contact details are only returned to authenticated administrators or when the customer supplies their order code and email for tracking.
- Back up the database regularly. Free Render Postgres databases do not include backups.
- The initial catalogue contains sample products. Replace them in the admin dashboard before opening the shop to customers.
