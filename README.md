# Tanger Orders

Mobile-first shared order tracker for local Tanger delivery. It can be installed from the browser once deployed over HTTPS.

## Run it locally

1. Run `npm.cmd install`.
2. Run `npm.cmd run dev`.
3. Open the address shown in the terminal.

## Connect the shared backend

1. Create a free Supabase project.
2. Apply `supabase/schema.sql`, then run the files in `supabase/migrations` in date order.
3. Copy `.env.example` to `.env.local` and put in the project URL and **publishable** key from Supabase's Connect panel. Do not use a service-role key.
4. The first person creates the workspace; the second signs up and joins using the workspace code.

The production app uses Supabase for shared data. Local development supports `?demo=1` for a browser-only preview. Inventory restocks are stored as cost batches and delivered orders consume those batches FIFO, preserving historical profit and allowing exact stock reversal when an order is reopened.
