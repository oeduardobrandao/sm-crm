# Mesaas iOS app

Capacitor 8 shell that loads the live CRM (`https://www.mesaas.com.br`). The CRM is the only UI;
see `DECISIONS.md` for why and `PLAN.md` for what is left.

## Run in the Simulator

```bash
cd apps/mobile
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer   # if xcode-select points at the CLT
npx cap sync ios
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 18 Pro' \
  -derivedDataPath ios/App/build/DerivedData build
xcrun simctl install booted ios/App/build/DerivedData/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch booted br.com.mesaas.app
```

Or `npm run open -w @sm-crm/mobile` and press Run in Xcode.

To point a Simulator build at another CRM (local or staging), sync with
`MESAAS_APP_URL=http://localhost:5173 npx cap sync ios`. Never ship a build synced that way.

## When an App Store build is needed

Only when something under `apps/mobile/` changes (plugins, Info.plist, icons, native code).
Web changes reach installed apps on the next Vercel deploy.
