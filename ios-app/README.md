# LobsterMobile iOS

Current direction:

- Native SwiftUI app, not a wrapped web view
- Default onboarding is `pairing + cloud relay`, not manual `Base URL + token`
- Mobile-first chat surface with a left history drawer
- Reuses the same local gateway contract that will later carry voice, video, and device-native permissions

## What is included

- `project.yml` for generating an Xcode project with XcodeGen
- SwiftUI app shell and feature structure
- Relay client for:
  - pairing invite claim
  - paired host list
  - host session list
  - relay text turns with polling-based progress updates
- Direct bridge client kept as `Advanced` mode for local debugging
- Local storage for relay pairing state and optional direct bridge config

## Open and run

1. Open [/Users/caijinhong/Desktop/MyProject/agenthub/.worktrees/codex-agenthub-relay-v1/ios-app/LobsterMobile.xcodeproj](/Users/caijinhong/Desktop/MyProject/agenthub/.worktrees/codex-agenthub-relay-v1/ios-app/LobsterMobile.xcodeproj) in Xcode
2. Select the `LobsterMobile` scheme
3. Choose an iPhone simulator or a real device
4. Press Run

CLI build for simulator:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
xcodebuild \
  -project LobsterMobile.xcodeproj \
  -scheme LobsterMobile \
  -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  build
```

## Pairing flow

On first launch, the app opens the connection sheet and expects a desktop pairing link:

1. Start AgentHub desktop from the same worktree branch
2. In `Remote Hosts`, configure the relay URL and start `Remote Mode`
3. Generate a pairing invite
4. Paste the pairing link into the iOS app
5. The app will load `Hosts -> Sessions -> Chat`

`Advanced` mode still exposes direct bridge fields for local debugging on the same Mac.

## Run on a real iPhone

For local device testing, you do not need App Store packaging yet. You only need a signed development build:

1. Connect the iPhone to your Mac
2. In Xcode, select your device as the run destination
3. Open `Signing & Capabilities`
4. Pick your Apple team or Personal Team
5. If the bundle id conflicts, change it to a unique value such as `com.<yourname>.lobstermobile.dev`
6. On the iPhone, enable Developer Mode if prompted
7. Press Run and let Xcode install the app

CLI build for a physical device:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
xcodebuild \
  -project LobsterMobile.xcodeproj \
  -scheme LobsterMobile \
  -configuration Debug \
  -destination 'generic/platform=iOS' \
  build
```

If you need a signed archive later, do that from Xcode Organizer after the development install path is stable.

## Rename later

`LobsterMobile` is only a working app name. It can be renamed after the product name is finalized.
