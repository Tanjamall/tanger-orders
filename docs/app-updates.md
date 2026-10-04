# Tanger Orders updates

The Android app includes the Capgo updater in self-hosted mode. It checks `https://tanger-orders.pages.dev/api/app-update` when opened, downloads a compatible web bundle, and applies it the next time the app goes to the background. `notifyAppReady()` at startup lets the updater roll back a bundle that fails to launch.

For a web-only release, increase the patch version in `package.json` and `package-lock.json`, run `npm run build` and the checks, then push to `main`. The Cloudflare Pages build uses `npm run build`, which packages the official Capgo ZIP and serves it with `updates/web.json`. Keep `minNativeBuild` in `scripts/package-update.mjs` at the earliest APK versionCode that supports every native feature used by the web release. A native plugin or permission change requires a new APK before raising this value.

For an Android release, increase `versionCode` and `versionName` in `android/app/build.gradle`, set the matching values and release asset URL in `public/updates/android.json`, sync Capacitor, and build the APK. Publish that signed APK as a GitHub release asset before deploying the manifest. The in-app Settings check compares Android versionCode and downloads a newer APK when available. Android asks the user to allow installation from Tanger Orders and to confirm the install. Keep the same application ID and signing key for install-over updates.

The initial updater-enabled APK is versionCode 8 / versionName 1.5.0. APKs older than this cannot receive web bundles and must be installed over once.
