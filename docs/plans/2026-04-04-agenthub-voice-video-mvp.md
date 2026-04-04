# AgentHub Voice And Video MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a real voice-call path on top of the existing relay text stack, with a clean upgrade path for camera share and Gemini-powered video understanding.

**Architecture:** Keep Cloudflare Relay as the control plane for pairing, host/session selection, and call signaling. Introduce a new `call` layer shared by iOS, the local desktop gateway, and the relay worker. Voice media is modeled as a dedicated session with provider-backed signaling and transcription hooks; the first implementation prioritizes a working agent voice loop over a full multi-party media stack. Video is explicitly phase-two and starts with sampled-frame understanding instead of full live video reasoning.

**Tech Stack:** Tauri Rust commands, Node.js local gateway script, Cloudflare Workers + D1, SwiftUI, existing AgentHub collaboration state, existing audio clip transcription commands, `xcodebuild`, Node built-in test runner, Rust test harness

### Task 1: Define shared call-state contracts

**Files:**
- Create: `docs/plans/2026-04-04-agenthub-voice-video-mvp.md`
- Modify: `relay/worker/src/protocol.js`
- Modify: `relay/worker/test/protocol.test.js`
- Modify: `ios-app/Sources/Models/RelayModels.swift`
- Modify: `ios-app/Tests/RelayModelsTests.swift`

**Step 1: Write the failing tests**

Add tests that expect:
- relay protocol can encode/decode call objects and call events
- iOS relay models can parse a selected host with an optional active call
- the call state distinguishes `idle`, `dialing`, `ringing`, `connecting`, `live`, `ended`, and `failed`

**Step 2: Run tests to verify they fail**

Run:

```bash
node --test relay/worker/test/protocol.test.js
```

Expected: FAIL because the protocol has no call shapes yet

Run:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
xcrun swiftc \
  -module-cache-path /tmp/relay-models-module-cache \
  -parse-as-library \
  -o /tmp/relay-models-tests \
  ios-app/Sources/Models/BridgeModels.swift \
  ios-app/Sources/Models/RelayModels.swift \
  ios-app/Tests/RelayModelsTests.swift
/tmp/relay-models-tests
```

Expected: FAIL because the relay models do not know about call state

**Step 3: Write minimal implementation**

Add:
- relay protocol helpers for call envelopes and event kinds
- `RelayCallSummary`, `RelayCallState`, and `RelayCallMode`
- iOS decoding for selected host/session plus optional active call

**Step 4: Run tests to verify they pass**

Run the same commands.

Expected: PASS

**Step 5: Commit**

```bash
git add relay/worker/src/protocol.js relay/worker/test/protocol.test.js ios-app/Sources/Models/RelayModels.swift ios-app/Tests/RelayModelsTests.swift docs/plans/2026-04-04-agenthub-voice-video-mvp.md
git commit -m "feat: add shared voice call contracts"
```

### Task 2: Add relay call signaling endpoints

**Files:**
- Modify: `relay/worker/src/storage.js`
- Modify: `relay/worker/src/index.js`
- Modify: `relay/worker/test/storage.test.js`
- Create: `relay/worker/test/call-signaling.test.js`

**Step 1: Write the failing tests**

Add tests that expect:
- a client can create a call for a host/session pair
- a host can update call state as it accepts or ends the call
- a client can poll the active call state and receive signaling metadata

**Step 2: Run tests to verify they fail**

Run:

```bash
node --test relay/worker/test/storage.test.js relay/worker/test/call-signaling.test.js
```

Expected: FAIL because the worker only supports text turns today

**Step 3: Write minimal implementation**

Implement:
- storage tables/helpers for active calls per host
- endpoints:
  - `POST /api/calls`
  - `POST /api/hosts/:hostId/calls/:callId/events`
  - `GET /api/clients/:clientId/calls/:callId`
- conservative state transitions with one active call per host

**Step 4: Run tests to verify they pass**

Run the same command.

Expected: PASS

**Step 5: Commit**

```bash
git add relay/worker/src/storage.js relay/worker/src/index.js relay/worker/test/storage.test.js relay/worker/test/call-signaling.test.js
git commit -m "feat: add relay call signaling"
```

### Task 3: Add local gateway call controller and ASR provider abstraction

**Files:**
- Create: `src-tauri/scripts/gateway-call-controller.mjs`
- Modify: `src-tauri/scripts/remote-bridge-worker.mjs`
- Modify: `src-tauri/src/commands/cli.rs`
- Create: `src-tauri/scripts/__tests__/gateway-call-controller.test.mjs`
- Create: `src-tauri/src/commands/audio.rs`
- Create: `src-tauri/src/commands/audio_tests.rs`

**Step 1: Write the failing tests**

Add tests that expect:
- the local gateway can start one voice call session for a selected host/session
- the gateway can convert an uploaded audio chunk into a queued ASR job
- provider resolution supports a named transcription backend instead of a hardcoded transcription model

**Step 2: Run tests to verify they fail**

Run:

```bash
node --test src-tauri/scripts/__tests__/gateway-call-controller.test.mjs
~/.cargo/bin/cargo test audio --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL because the gateway has no call controller and audio commands are still hardcoded

**Step 3: Write minimal implementation**

Implement:
- a call controller that tracks one active voice call and its selected session
- extraction of transcription provider/model resolution from `cli.rs`
- a provider config shape that can later point to Doubao streaming ASR while preserving the current clip-transcription fallback

**Step 4: Run tests to verify they pass**

Run the same commands.

Expected: PASS

**Step 5: Commit**

```bash
git add src-tauri/scripts/gateway-call-controller.mjs src-tauri/scripts/remote-bridge-worker.mjs src-tauri/src/commands/cli.rs src-tauri/src/commands/audio.rs src-tauri/scripts/__tests__/gateway-call-controller.test.mjs src-tauri/src/commands/audio_tests.rs
git commit -m "feat: add local gateway voice call controller"
```

### Task 4: Add iOS call state and call controls

**Files:**
- Modify: `ios-app/Sources/Features/Chat/ChatStore.swift`
- Modify: `ios-app/Sources/Features/Chat/RootChatView.swift`
- Create: `ios-app/Sources/Services/CallClient.swift`
- Modify: `ios-app/Tests/RelayModelsTests.swift`

**Step 1: Write the failing tests**

Add tests that expect:
- the store can start, connect, and end a voice call against the selected relay host/session
- call actions do not break the existing text chat state
- iOS call UI shows `dialing` and `live` state without mutating the selected session

**Step 2: Run tests to verify they fail**

Run:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
xcrun swiftc \
  -module-cache-path /tmp/relay-models-module-cache \
  -parse-as-library \
  -o /tmp/relay-models-tests \
  ios-app/Sources/Models/BridgeModels.swift \
  ios-app/Sources/Models/RelayModels.swift \
  ios-app/Sources/Services/RelayClient.swift \
  ios-app/Sources/Services/CallClient.swift \
  ios-app/Sources/Features/Chat/ChatStore.swift \
  ios-app/Tests/RelayModelsTests.swift
/tmp/relay-models-tests
```

Expected: FAIL because the store has no call actions yet

**Step 3: Write minimal implementation**

Implement:
- `CallClient` for relay call creation and status polling
- `ChatStore` call state for start/end/connect
- a header-level call button and compact in-chat call banner in `RootChatView`

**Step 4: Run tests to verify they pass**

Run the same command.

Expected: PASS

**Step 5: Commit**

```bash
git add ios-app/Sources/Features/Chat/ChatStore.swift ios-app/Sources/Features/Chat/RootChatView.swift ios-app/Sources/Services/CallClient.swift ios-app/Tests/RelayModelsTests.swift
git commit -m "feat: add iOS voice call controls"
```

### Task 5: Add voice session diagnostics and packaging checklist

**Files:**
- Modify: `src/pages/RemoteHostsPage.tsx`
- Modify: `ios-app/README.md`
- Optional create: `docs/plans/2026-04-04-agenthub-voice-smoke-test.md`

**Step 1: Write the checklist**

Document:
- required provider secrets and where they live
- desktop indicators for active call state
- iPhone test path for pairing, starting a call, and recovering from a dropped call
- the fallback transcription path when Doubao streaming credentials are absent

**Step 2: Implement minimal diagnostics**

Show:
- whether the local gateway sees an active voice call
- whether the configured transcription backend is reachable

**Step 3: Verify the build path**

Run:

```bash
npm run build
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
xcodebuild \
  -project ios-app/LobsterMobile.xcodeproj \
  -scheme LobsterMobile \
  -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  build
```

Expected: desktop and iOS both build cleanly with the new call scaffolding

**Step 4: Commit**

```bash
git add src/pages/RemoteHostsPage.tsx ios-app/README.md docs/plans/2026-04-04-agenthub-voice-smoke-test.md
git commit -m "docs: add voice smoke test checklist"
```

### Task 6: Phase-two video frame understanding scaffold

**Files:**
- Create: `src-tauri/scripts/gateway-vision-controller.mjs`
- Create: `src-tauri/scripts/__tests__/gateway-vision-controller.test.mjs`
- Modify: `ios-app/Sources/Features/Chat/RootChatView.swift`
- Modify: `ios-app/Sources/Features/Chat/ChatStore.swift`

**Step 1: Write the failing tests**

Add tests that expect:
- the iOS app can enter a `camera-share` mode without starting a full video call
- the local gateway can accept sampled image frames and enqueue them for vision analysis

**Step 2: Run tests to verify they fail**

Run:

```bash
node --test src-tauri/scripts/__tests__/gateway-vision-controller.test.mjs
```

Expected: FAIL because no camera-share controller exists

**Step 3: Write minimal implementation**

Implement:
- a sampled-frame upload path from iOS
- a local gateway queue for image-frame understanding
- a provider slot for Gemini 2.5 Flash / Live Flash class models

**Step 4: Run tests to verify they pass**

Run the same command.

Expected: PASS

**Step 5: Commit**

```bash
git add src-tauri/scripts/gateway-vision-controller.mjs src-tauri/scripts/__tests__/gateway-vision-controller.test.mjs ios-app/Sources/Features/Chat/RootChatView.swift ios-app/Sources/Features/Chat/ChatStore.swift
git commit -m "feat: scaffold camera share vision path"
```
