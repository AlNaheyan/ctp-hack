# macOS Build Setup

This repository is a hackathon fork of Boring Notch. The baseline recorded on 2026-08-27 builds the application and its embedded XPC helper without a personal signing identity.

## Verified baseline

| Item | Value |
|---|---|
| Fork commit | `9c0e5074625731139b103f2be7f457d53a1df066` |
| Imported upstream commit | `8631461be97933e024dd97788440fee2f9b471b3` |
| Origin | `https://github.com/AlNaheyan/ctp-hack.git` |
| Upstream | `https://github.com/TheBoredTeam/boring.notch.git` |
| Xcode used | 16.3 (`16E140`) |
| macOS used | 15.7.3 (`24G419`) |
| macOS deployment target | 14.0 |
| Main scheme/target | `boringNotch` |
| Helper scheme/target | `BoringNotchXPCHelper` |

Outside `README.md` and `docs/roadmap`, the fork commit’s tree matches the imported upstream commit. Verify that relationship with:

```bash
git diff --quiet upstream/main 9c0e507 -- . ':!README.md' ':!docs'
```

The imported SHA is recorded explicitly; do not substitute a newer `upstream/main` after upstream advances.

## Clean-checkout build

Prerequisites:

- macOS 14 Sonoma or newer;
- Xcode 16.3 or newer compatible with the pinned package graph; and
- network access for the first Swift package resolution.

Clone and configure remotes:

```bash
git clone https://github.com/AlNaheyan/ctp-hack.git
cd ctp-hack
git remote add upstream https://github.com/TheBoredTeam/boring.notch.git
git fetch upstream main
```

Resolve packages and build the complete app dependency graph:

```bash
xcodebuild \
  -project boringNotch.xcodeproj \
  -scheme boringNotch \
  -derivedDataPath /tmp/ctp-hack-derived \
  -resolvePackageDependencies

xcodebuild \
  -project boringNotch.xcodeproj \
  -scheme boringNotch \
  -configuration Debug \
  -destination 'platform=macOS' \
  -derivedDataPath /tmp/ctp-hack-derived \
  CODE_SIGNING_ALLOWED=NO \
  build
```

The `boringNotch` scheme depends on `BoringNotchXPCHelper`, so that command compiles the main app and embeds the helper. To verify the helper scheme independently:

```bash
xcodebuild \
  -project boringNotch.xcodeproj \
  -scheme BoringNotchXPCHelper \
  -configuration Debug \
  -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath /tmp/ctp-hack-derived \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Use a different explicit `-derivedDataPath` if `/tmp/ctp-hack-derived` is shared or unavailable. Do not place DerivedData in the repository.

## Run and smoke check

The unsigned command-line build can be launched locally with:

```bash
open /tmp/ctp-hack-derived/Build/Products/Debug/boringNotch.app
```

Complete this visual smoke check on a logged-in desktop session:

1. Confirm the menu-bar star and closed notch appear.
2. Move the pointer over the notch and confirm it expands to the home surface.
3. Move the pointer away and confirm it closes after the normal delay.
4. Open Settings and Shelf once, then confirm the notch still closes.
5. Trigger a volume or brightness HUD and confirm the compact activity renders.

The 2026-08-27 automation run successfully launched the built application. The execution environment could not inspect the GUI or process list, so steps 1–5 remain an explicit human visual check on a clean machine.

## Bundle identifiers and signing

Hackathon targets intentionally use:

- app: `com.ctphack.discussionnotch`
- embedded helper: `com.ctphack.discussionnotch.BoringNotchXPCHelper`

`XPCHelperClient.serviceName` must remain identical to the helper bundle identifier.

Both targets keep `DEVELOPMENT_TEAM` empty. CI and command-line verification use `CODE_SIGNING_ALLOWED=NO`. For local debugging, select a personal team through Xcode’s Signing & Capabilities UI or pass a team as an untracked/user-level setting. Never commit a team ID, certificate name, provisioning profile, or changes under `xcuserdata`.

Distribution signing and notarization are deliberately deferred to W4-T3.

## Permissions

The app may request these macOS permissions as the corresponding feature is exercised:

- Accessibility, through the XPC helper, for media keys and system controls;
- Automation/Apple Events for Apple Music and Spotify control;
- Camera for the mirror;
- Calendars and Reminders for calendar content;
- user-selected file access for Shelf; and
- network access for updates and network-backed features.

The basic notch open/close smoke check does not require granting Camera, Calendar, or Reminders access. Denying optional permissions should disable only the related feature.

## Known warnings

- `xcodebuild` may report multiple matching macOS destinations on a universal-capable Mac. Use `-destination 'platform=macOS,arch=arm64'` (or `x86_64` on Intel) for a deterministic architecture.
- Xcode 16.3 reports `Metadata extraction skipped. No AppIntents.framework dependency found.` This is informational; the app declares no App Intents dependency.
- Sandboxed shells may emit CoreSimulator and Xcode log-store permission errors even for a macOS target. An explicit writable `-derivedDataPath` avoids the package/log-store failure; simulator warnings do not affect the macOS build.
- The first build is lengthy because it compiles the pinned Swift package graph. Subsequent builds reuse the chosen DerivedData directory.

No product-source warning or unresolved build error was observed in the verified Debug build.

## Updating from upstream

Keep upstream history out of `main` except through an intentional, reviewed update branch:

```bash
git fetch upstream main
git switch -c maintenance/upstream-YYYY-MM-DD main
git merge --no-ff upstream/main
```

Resolve and test that branch, preserve the fork README/roadmap, and merge it through a pull request. Do not force-push `main`, replace `main` with `upstream/main`, or change `origin` to the upstream repository. Record the old and new upstream SHAs in the update PR.
