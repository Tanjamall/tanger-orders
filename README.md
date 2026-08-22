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

## Android build and notifications

The Capacitor Android app uses the package name `com.tanjamall.tangerorders`. Run `npm run android:sync` after changing web code, then open the generated project with `npm run android:open`.

Native notifications require one-time Firebase setup:

1. Create a Firebase project and register an Android app with package name `com.tanjamall.tangerorders`.
2. Download `google-services.json` into `android/app/google-services.json`.
3. In Firebase Project Settings > Service accounts, generate a private key JSON.
4. In Supabase Edge Functions > Secrets, create `FIREBASE_SERVICE_ACCOUNT` whose value is the complete, single-line service-account JSON. Never commit that private-key file.
5. Re-run `npm run android:sync`, build the APK, install it, and enable notifications in the app's Settings screen.

Browser notifications continue to use Web Push. Android devices are stored separately in the RLS-protected `android_push_devices` table, and the `notify-new-order` function sends to both channels.
