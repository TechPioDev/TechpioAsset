# Microsoft 365 licences

PioAssets can read the Microsoft 365 subscriptions your company owns and keep
them in **Licences**: the product, seats bought, seats in use, status and the
next renewal date. It refreshes every night.

## What you need

- A **Global Administrator** in your Microsoft 365 tenant, for about ten minutes.
- A PioAssets account that can open **Settings → Integrations** (Super Admin).

## Set it up

### 1. Create the app registration (Microsoft side)

1. Open the Microsoft Entra admin centre: <https://entra.microsoft.com>.
2. Go to **Applications → App registrations → New registration**.
3. Name it `PioAssets licence sync`. Leave the other options as they are and
   choose **Register**.
4. On the overview page, copy two values:
   - **Directory (tenant) ID**
   - **Application (client) ID**
5. Go to **API permissions → Add a permission → Microsoft Graph →
   Application permissions**. Search for and tick **Organization.Read.All**,
   then **Add permissions**.
6. Choose **Grant admin consent** and confirm. The status column should show a
   green tick.
7. Go to **Certificates & secrets → New client secret**. Give it a description,
   choose an expiry (24 months is the longest), and **Add**.
8. Copy the secret **Value** now. Microsoft shows it once.

`Organization.Read.All` is read-only. It lets PioAssets see which subscriptions
the tenant owns. It cannot change anything in Microsoft 365, and it cannot read
mail, files or users.

### 2. Connect (PioAssets side)

1. In PioAssets open **Settings → Integrations → Microsoft 365 licences**.
2. Paste the **Tenant ID**, the **Client ID** and the **client secret**, then
   choose **Connect**.
3. Choose **Test connection**. It reads from Microsoft and lists what would be
   recorded, without writing anything.
4. If the list looks right, choose **Sync now**.

The secret is stored encrypted and is never shown again. Paste it only into
this screen; do not send it by chat or email.

## What you will see

- Each paid subscription appears in **Licences** with a **Microsoft 365** label.
- Seats, dates and status come from Microsoft. To give or take away a seat, use
  the Microsoft 365 admin centre; the change appears after the next sync.
- **Cost, vendor, notes and the order number are yours.** Microsoft does not
  share prices this way, so a Finance user enters the cost once and no sync
  ever overwrites it.
- The dashboard's "licences expiring" and "licences full or near" tiles include
  these licences.

## What is left out on purpose

- **Free products** such as Power Automate Free, which arrive with 10,000 or
  more "seats".
- **Tenant-wide entitlements**, which have no seats to count.
- **Products with nothing bought and nothing in use.**

The settings screen says how many were left out, so the number recorded is
never mistaken for everything Microsoft lists.

## When something changes

| What happened                 | What PioAssets does                                                       |
| ----------------------------- | ------------------------------------------------------------------------- |
| Seats added or removed        | Updates the count and adds a line to the licence's renewal history.       |
| Subscription cancelled        | Marks the licence **Retired**. Its history, cost and notes are kept.      |
| Subscription bought again     | Brings the same licence back, rather than creating a second one.          |
| Microsoft renames the product | Follows it. Licences are matched by Microsoft's product id, not the name. |
| More seats in use than owned  | Shows the overshoot on the licence and on the settings screen.            |

## When a sync fails

The reason is shown on **Settings → Integrations**, in words. Licences keep the
last values that were read; nothing is changed by a failed sync.

| Message                                   | What to do                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| The client secret is wrong or has expired | Create a new secret in Entra (step 7) and paste it into the settings screen. |
| The tenant ID or client ID does not match | Copy both ids again from the app registration's overview page.               |
| Not allowed to read subscriptions         | Add `Organization.Read.All` and grant admin consent (steps 5 and 6).         |

Client secrets expire. Put a reminder in your calendar a few weeks before the
expiry date you chose.

## Limits

- **No prices.** Microsoft does not provide them through this route.
- **No list of who holds each seat.** PioAssets shows how many seats are in
  use, not which person has which one.
- **Not yet proven against a live tenant.** The sync was built and tested
  against a simulated Microsoft tenant, and its error handling was checked
  against Microsoft's real sign-in service. The first sync on your tenant is
  the first real read, which is why **Test connection** exists: look at what it
  lists before you choose **Sync now**.
