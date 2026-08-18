# Play Store Release Guide

## Prerequisites

| Tool | Version |
|------|---------|
| Android Studio | Ladybug (2024.2) or newer |
| JDK | 17 |
| Node.js | 20+ |

---

## 1. First-time Setup

### Install dependencies
```bash
npm ci
```

### Generate app icons and splash screen
```bash
npm run cap:assets
```

---

## 2. Generate a Release Keystore (one-time)

> **Never commit the `.jks` file or any passwords to version control.**

```bash
keytool -genkey -v \
  -keystore theprints3d-release.jks \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -alias theprints3d \
  -dname "CN=ThePrints3D, OU=Mobile, O=YourOrg, L=City, S=State, C=US"
```

Store the `.jks` file in a secure location (password manager or secrets vault). **Back it up — losing it means you can never update your Play Store app.**

---

## 3. Build the Android App Bundle (AAB)

### Option A: Using environment variables (CI/CD)

```bash
export ANDROID_KEYSTORE_PATH=/path/to/theprints3d-release.jks
export ANDROID_KEY_ALIAS=theprints3d
export ANDROID_KEYSTORE_PASSWORD=<your-store-password>
export ANDROID_KEY_PASSWORD=<your-key-password>

npm run build:android
cd android
./gradlew bundleRelease
```

The signed AAB will be at:
```
android/app/build/outputs/bundle/release/app-release.aab
```

### Option B: Using Android Studio

1. `npm run build:android`
2. `npm run open:android` — this opens the `android/` project in Android Studio
3. **Build → Generate Signed Bundle / APK**
4. Select **Android App Bundle**
5. Enter your keystore path, alias, and passwords
6. Build variant: **release**

---

## 4. Play Store Listing Assets

### Required screenshots (portrait 1080×1920 or tablet 1200×1900)
Place screenshots in `public/screenshots/` before building. At least 2 are required.

Suggested screenshots:
1. Upload screen (drag-and-drop zone)
2. Drawing review / scale calibration
3. Interactive 3D model view
4. Layer toggle panel

### Feature graphic (required)
- Size: 1024×500 px
- Add as `public/store-assets/feature-graphic.png`

### Store listing text

**The settled copy lives in [`play-store-listing.md`](./play-store-listing.md)** —
app name, short description, full description, feature bullets, brand hexes and
the asset checklist. Copy it from there.

> An earlier draft of the description used to be inlined here and had gone stale.
> Don't re-draft the listing; there is one version and it is in that file.

### Supported file types
PDF, PNG, JPG, TIFF, WebP

### Content rating
- Complete the IARC questionnaire in Play Console
- Category: **Productivity**
- No violence, no user-generated content, no location data

---

## 5. Play Console Submission Checklist

- [ ] Google Play developer account registered ($25 one-time fee)
- [ ] App created in Play Console (package: `com.theprints3d.app`)
- [ ] Signed AAB uploaded to **Internal testing** track first
- [ ] Store listing filled in (title, description, screenshots, feature graphic)
- [ ] Privacy policy URL added to store listing (host `public/manifest.json` privacy policy or a standalone page)
- [ ] Content rating questionnaire completed
- [ ] Target audience set (18+, professional use)
- [ ] Pricing set (Free)
- [ ] Countries / regions selected
- [ ] Roll out to **Production** track once internal testing passes

---

## 6. Updating the App

1. Bump `versionCode` and `versionName` in `android/app/build.gradle`
2. Run `npm run build:android`
3. Build a new signed AAB
4. Upload to Play Console → select track → review → rollout
