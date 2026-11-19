# CrazyCreations

A bright, responsive online shop with **pay on delivery only**, a private admin dashboard, shared orders and delivery tracking.

## Deploy on Render

1. Open [Render](https://render.com) and choose **New → Blueprint**.
2. Connect the GitHub repository `Rohansweb-codexamples/Crazycreations`.
3. Render reads `render.yaml` and creates the Node web service and PostgreSQL database.
4. When prompted, set:
   - `ADMIN_EMAIL`: the email address you will use to sign into the admin area.
   - `ADMIN_PASSWORD`: a strong, unique password (at least 12 characters).
5. Deploy. The site will be served from the Render URL. The app automatically creates its database tables and initial admin account on first start.

## Pages

- `/` — customer shop, basket and checkout
- `/track` — order tracking
- `/admin` — private admin dashboard

## Payment

Checkout is **Pay on delivery**. No card payment provider is connected or requested.

## Notes

- Product images are managed using image URLs in the admin dashboard.
- The database is shared by all visitors; orders are not stored only in a visitor's browser.
- Keep `ADMIN_PASSWORD`, `SESSION_SECRET` and `DATABASE_URL` private. Never put them in frontend files or commit them to GitHub.
- The initial catalogue contains sample products. Replace them in the admin dashboard before opening the shop to customers.
