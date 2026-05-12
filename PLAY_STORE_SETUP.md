# BluePrint3D — Play Store Submission Setup

This repo is configured to build a signed Android App Bundle (`.aab`) via GitHub
Actions. The recipe mirrors CircuiTry3D's, so anything that works there should
work here.

## TL;DR — getting a downloadable .aab

1. Add these **GitHub Actions secrets** under `Settings → Secrets and variables → Actions`:

   | Secret | What it is | How to make it |
   |---|---|---|
   | `ANDROID_KEYSTORE_BASE64` | Your upload keystore (`.jks`) base64-encoded | `base64 -w0 upload-key.jks` |
   | `ANDROID_KEY_ALIAS` | The key alias inside the keystore | Same as you used when creating the keystore (default: `blueprint3d-upload`) |
   | `ANDROID_KEY_PASSWORD` | Password for the key | Whatever you set during `keytool -genkey` |
   | `ANDROID_STORE_PASSWORD` | Password for the keystore file | Often the same as `ANDROID_KEY_PASSWORD` |

2. Push any commit to `main` (or click **Actions → Build AAB → Run workflow**).

3. After ~3 minutes, download the AAB from the workflow run's **Artifacts** section.

4. Upload it to the **Play Console → Internal testing** track.

## Creating the upload keystore (one-time)

```bash
keytool -genkey -v \
  -keystore upload-key.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias blueprint3d-upload
```

Then `base64 -w0 upload-key.jks` and paste into the GitHub secret.

## Local builds (optional)

If you have Android Studio + JDK 21 installed locally:

```bash
./build-android.sh
```

That will: `npm install` → `npm run build` (Vite) → `npx cap sync android` → `./gradlew bundleRelease` → output the AAB to `android/app/build/outputs/bundle/release/`.

You'll also need a local `android/key.properties` file — see `android/key.properties.example`. **Do not commit `key.properties`.**

## Generating the `android/` folder for the first time

Capacitor needs to scaffold the native Android project once. Do this on a machine with Android Studio installed:

```bash
npm install
npm run build
npx cap add android
```

Then commit the `android/` folder. After that, every future build (local or CI) uses it.

> **CI will fail until `android/` is committed.** This is the only step that has to happen on a real dev machine. After that the GitHub Action handles everything.

## Play Store assets

Mirror CircuiTry3D's `play-store-assets/` structure for icons, screenshots, and feature graphic. The `npm run generate-icons` / `generate-splash` scripts can be ported from CircuiTry3D in a follow-up.
