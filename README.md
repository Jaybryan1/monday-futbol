# MONDAY FC — GitHub Pages + Supabase + Stripe

A responsive pickup soccer signup site: 12-player roster, waitlist, Monday 9:00 PM Central opening, Zelle admin verification, optional Stripe Checkout with Apple Pay on eligible devices.

## Important: how it works

- Registration for a new **weekly Monday roster** opens **Monday at 9:00 PM `America/Chicago`** (respects CST/CDT daylight saving). Before opening, the **database** blocks submissions, not just the website. After opening, registration remains available until the next Monday begins; the next week's list unlocks that Monday at 9:00 PM. (Between Monday 12:00 AM and 8:59:59 PM the new list is locked.)
- First **12** signups join the provisional roster; others go on the waitlist. One signup per authenticated visitor (Supabase anonymous identity) per week.
- Payment **locks** a place. Zelle payments are manually verified by admin; Apple Pay/card payment confirmations are sent directly from Stripe via a signed webhook.
- If a paid waitlisted player can replace an unpaid roster player, the **most recently signed-up unpaid roster player** moves to the waitlist, and the paid player takes the roster place. If the roster consists of 12 paid players, the paid newcomer remains on the paid waitlist.
- On reload on the same device the anonymous signup identity persists. Clearing browser data or changing devices produces a new anonymous identity; this is not anti-spam protection. For a public launch with strangers, switch to email/phone OTP and add bot protections.
- Players cannot verify their own Zelle payments.

## 1. Create Supabase backend

1. Create a free project at https://supabase.com.
2. Supabase **Authentication → Providers → Anonymous Sign-Ins**: enable anonymous sign-ins (required for player submissions).
3. Supabase **SQL Editor**: execute `supabase/migrations/001_setup.sql` in full.
4. Supabase **Project Settings → API**: copy the Project URL and **publishable / anon key** (NEVER a service-role key).
5. Open `config.js`; fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and optionally `SITE_NAME`.
6. Supabase **SQL Editor**: configure your event (modify these values):

```sql
update public.site_settings
set price_cents = 1000, -- $10.00, change as needed
    currency = 'usd',
    zelle_recipient = 'admin@example.com', -- replace with REAL Zelle recipient
    venue = 'Your soccer field address',
    game_time = 'Mondays • 10:00 PM CT',
    stripe_enabled = false
where id = 1;
```

## 2. Create the admin

1. Supabase **Authentication → Users**: Add a user with an email and strong password (or create one through normal auth flow). The email/password login is only used in the Admin dialog.
2. Supabase SQL Editor:

```sql
insert into public.admins(user_id)
select id from auth.users where email = 'YOUR_ADMIN_EMAIL_HERE'
on conflict do nothing;
```

3. On the site, click **Admin**, log in using the admin account, and click **CONFIRM ZELLE** on each player **only after Zelle confirms receipt**. The roster immediately reshuffles if the person was waitlisted.

## 3. Publish via GitHub Pages

1. Create a new GitHub repository, e.g. `monday-futbol`, and upload all the project files, including `config.js`.
2. Go to your repository **Settings → Pages → Build and deployment → Deploy from a branch**; select `main` and `/(root)`.
3. Site URL: `https://YOUR_USERNAME.github.io/monday-futbol/` (use your actual repo and user name).
4. Test the site on a phone. Public Supabase project URL and anon/publishable key in `config.js` are **intended to be public**, protected by SQL authorization policies. **Never commit your Supabase service-role key or Stripe secret key.**
5. Optionally configure Supabase auth URL settings to include your GitHub Pages origin. Anonymous authentication typically does not require redirect URLs.

## 4. OPTIONAL: Apple Pay via Stripe Checkout

Zelle-only works without Stripe. Apple Pay **cannot** be processed directly by a static GitHub Pages site. Stripe Checkout handles secure payments, Apple Pay visibility and eligible-wallet validation. Requires a Stripe account, setup, transaction fees, your site served over HTTPS, and a supported browser/device with a configured wallet.

Install Supabase CLI (`npm install -g supabase`), link your Supabase project (`supabase login` and `supabase link --project-ref YOUR_PROJECT_REF`), then:

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_YOUR_KEY \
  SITE_URL=https://YOUR_USERNAME.github.io/monday-futbol/
supabase functions deploy create-checkout
supabase functions deploy stripe-webhook --no-verify-jwt
```

In Stripe **Developers → Webhooks**, add endpoint:

`https://YOUR_PROJECT.supabase.co/functions/v1/stripe-webhook`

Subscribe to `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Copy its **signing secret** and set:

```bash
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_YOUR_SIGNING_SECRET
```

Enable checkout button:

```sql
update public.site_settings set stripe_enabled = true where id = 1;
```

The Stripe-hosted checkout offers Apple Pay **where supported**; on unsupported devices it offers a card. Stripe will automatically confirm payment from the verified webhook, without the admin doing anything. Confirm Apple Pay domain requirements with Stripe if using a custom domain. Test with Stripe test keys and webhooks before using live funds.

## 5. Quick tests

- Monday at 8:59 PM Central: submit attempt is rejected in SQL with a time error.
- Monday at 9:00 PM Central: first 12 are roster; thirteenth is waitlisted.
- Verify Zelle for player 13 while player 12 is unpaid: player 13 gets a roster spot; player 12 is waitlisted.
- Verify all 12 current roster names; a newly paid waitlisted player remains waitlisted when all 12 are paid.
- Sign up from 2 browsers simultaneously: SQL transaction advisory lock ensures no more than 12 roster players.
- Next Monday: new week is blank and cannot accept names until 9 PM.
- Refresh after Stripe success: confirmation may take a few seconds while Stripe delivers its webhook.

## Security / production notes

- Supabase anonymous authentication limits one signup per *anonymous account* per week, not per real human. For stronger anti-abuse, use email OTP, Turnstile, signup-rate limits, and identity verification.
- Anyone can see the publicly displayed player names and paid/pending status. Avoid publishing full personal names if participants prefer privacy.
- Admins are assigned in SQL. No admin secret is present in the website.
- Payments cannot be marked as paid by anonymous visitors.
- Zelle is not automatically verified. Do not trust screenshots or statements of payment; confirm directly with Zelle/bank.
- Current MVP doesn't provide refunds, paid cancellation, chargeback reconciliation, or notifications. Process reversals manually and update business logic before financial production use.
- Always confirm legal, tax, and payment-provider requirements for collecting event fees.

## Customize

Edit `style.css` for colors; `index.html` for wording; `config.js` for public project credentials/site name; `site_settings` in Supabase for price and payment details. Keep `supabase/migrations/001_setup.sql` as the backend source of truth.
