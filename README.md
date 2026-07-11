# Tanger Orders

Mobile-first shared order tracker for local Tanger delivery. It can be installed from the browser once deployed over HTTPS.

## Run it locally

1. Run `npm.cmd install`.
2. Run `npm.cmd run dev`.
3. Open the address shown in the terminal.

## Connect the shared backend

1. Create a free Supabase project.
2. Copy `supabase/schema.sql` into the Supabase SQL Editor and run it once.
3. Copy `.env.example` to `.env.local` and put in the project URL and **publishable** key from Supabase's Connect panel. Do not use a service-role key.
4. Add email/password login and the Supabase data adapter (the next build step). The first person creates the workspace; the second signs up and joins using the workspace code.

The interface currently uses browser storage so the completed interface can be tested without credentials. The included SQL creates the secure shared workspace, inventory/order tables, real-time publication, and automatic stock changes on delivery.
