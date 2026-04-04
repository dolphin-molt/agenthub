# AgentHub Relay V1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the first working relay-based remote control path for AgentHub with desktop host registration, QR pairing, paired-host listing, session switching, and text turn routing.

**Architecture:** Add a new Cloudflare relay workspace for the control plane, keep the current local bridge as the desktop execution adapter, and add a desktop relay agent that syncs local sessions and forwards turn traffic. iOS moves from one hard-coded bridge endpoint to a paired-host model, but Phase 1 stays focused on text and signaling only.

**Tech Stack:** Cloudflare Workers, Durable Objects, D1, Node.js built-in test runner, Tauri Rust commands, Node relay client script, SwiftUI, existing AgentHub collaboration state

### Task 1: Scaffold the relay worker workspace

**Files:**
- Create: `relay/worker/package.json`
- Create: `relay/worker/wrangler.jsonc`
- Create: `relay/worker/src/index.js`
- Create: `relay/worker/src/protocol.js`
- Create: `relay/worker/src/objects/host-room.js`
- Create: `relay/worker/test/protocol.test.js`
- Create: `relay/worker/test/host-room.test.js`

**Step 1: Write the failing test**

Create a protocol round-trip test in `relay/worker/test/protocol.test.js` that expects:

- `createEnvelope()` to require `messageId`, `hostId`, and `type`
- `parseEnvelope()` to reject invalid payloads

Create a host room state test in `relay/worker/test/host-room.test.js` that expects:

- a new host connection generation to replace the old one
- a lease acquisition to fail when a different active controller already exists

**Step 2: Run test to verify it fails**

Run: `node --test relay/worker/test/protocol.test.js relay/worker/test/host-room.test.js`
Expected: FAIL because the worker modules do not exist yet

**Step 3: Write minimal implementation**

Implement:

- protocol helpers in `relay/worker/src/protocol.js`
- a pure state reducer for host-room behavior in `relay/worker/src/objects/host-room.js`
- a minimal `fetch()` entry in `relay/worker/src/index.js`

**Step 4: Run test to verify it passes**

Run: `node --test relay/worker/test/protocol.test.js relay/worker/test/host-room.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add relay/worker
git commit -m "feat: scaffold relay worker workspace"
```

### Task 2: Add relay metadata schema and persistence contract

**Files:**
- Create: `relay/worker/src/storage.js`
- Create: `relay/worker/test/storage.test.js`
- Modify: `relay/worker/src/index.js`
- Modify: `relay/worker/wrangler.jsonc`

**Step 1: Write the failing test**

Create `relay/worker/test/storage.test.js` covering:

- pairing invite creation with expiry
- pairing invite single-use claim behavior
- host metadata persistence shape

**Step 2: Run test to verify it fails**

Run: `node --test relay/worker/test/storage.test.js`
Expected: FAIL because storage helpers do not exist yet

**Step 3: Write minimal implementation**

Implement storage helpers that wrap D1 for:

- `createPairingInvite`
- `claimPairingInvite`
- `listPairedHosts`
- `upsertHostMetadata`

Add D1 binding config to `relay/worker/wrangler.jsonc`.

**Step 4: Run test to verify it passes**

Run: `node --test relay/worker/test/storage.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add relay/worker
git commit -m "feat: add relay metadata storage"
```

### Task 3: Add desktop relay runtime state and commands

**Files:**
- Create: `src-tauri/scripts/relay-agent.mjs`
- Modify: `src-tauri/src/commands/remote.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/commands/relay.rs`
- Create: `src/lib/relay/types.ts`

**Step 1: Write the failing test**

Add a Node test file `src-tauri/scripts/__tests__/relay-agent-config.test.mjs` covering:

- host registration payload shape
- session snapshot payload shape derived from local collaboration state

**Step 2: Run test to verify it fails**

Run: `node --test src-tauri/scripts/__tests__/relay-agent-config.test.mjs`
Expected: FAIL because the relay agent module does not exist yet

**Step 3: Write minimal implementation**

Implement:

- relay host runtime state file under `~/.agenthub/runtime/relay-agent.json`
- Tauri commands to start, stop, inspect, and generate pairing invites
- desktop relay agent script that reads local sessions and prepares registration envelopes

**Step 4: Run test to verify it passes**

Run: `node --test src-tauri/scripts/__tests__/relay-agent-config.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add src-tauri src/lib/relay
git commit -m "feat: add desktop relay agent scaffolding"
```

### Task 4: Extend the desktop Remote Hosts page for relay setup

**Files:**
- Modify: `src/pages/RemoteHostsPage.tsx`
- Create: `src/components/remote/PairingQRCodeCard.tsx`
- Create: `src/components/remote/RelayStatusCard.tsx`

**Step 1: Write the failing test**

If no UI test framework is present, write a manual verification checklist in `docs/plans/2026-04-03-agenthub-relay-v1-manual-checklist.md` first, covering:

- relay status visible
- generate pairing QR action visible
- paired-device section placeholder visible

**Step 2: Run test to verify it fails**

Run: `npm run build`
Expected: FAIL after introducing imports for components that do not exist yet

**Step 3: Write minimal implementation**

Add a relay-first section to the desktop page:

- current relay status
- start/stop relay controls
- generate pairing QR
- placeholder paired-device list

Do not remove the current local bridge controls yet.

**Step 4: Run test to verify it passes**

Run: `npm run build`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pages/RemoteHostsPage.tsx src/components/remote docs/plans/2026-04-03-agenthub-relay-v1-manual-checklist.md
git commit -m "feat: add desktop relay controls"
```

### Task 5: Replace iOS bridge config with paired-host navigation

**Files:**
- Modify: `ios-app/Sources/Models/BridgeModels.swift`
- Create: `ios-app/Sources/Models/RelayModels.swift`
- Modify: `ios-app/Sources/Services/BridgeClient.swift`
- Create: `ios-app/Sources/Services/RelayClient.swift`
- Modify: `ios-app/Sources/Features/Chat/ChatStore.swift`
- Modify: `ios-app/Sources/Features/Chat/ConnectionSheet.swift`
- Create: `ios-app/Sources/Features/Chat/HostListView.swift`
- Create: `ios-app/Sources/Features/Chat/SessionListView.swift`

**Step 1: Write the failing test**

If unit test targets are absent, start by writing a state transition checklist in comments inside `ChatStore.swift` for:

- claim pairing invite
- load hosts
- select host
- load sessions
- select session

**Step 2: Run test to verify it fails**

Run: `env DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project ios-app/LobsterMobile.xcodeproj -scheme LobsterMobile -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build`
Expected: FAIL once new relay types are referenced but not yet implemented

**Step 3: Write minimal implementation**

Replace manual URL entry with:

- pairing code / QR claim entry
- paired host list
- session list for selected host
- turn submission routed through selected `hostId` and `sessionId`

**Step 4: Run test to verify it passes**

Run the same `xcodebuild` command
Expected: PASS

**Step 5: Commit**

```bash
git add ios-app
git commit -m "feat: add ios relay pairing and session switching"
```

### Task 6: Migrate web control to host/session navigation

**Files:**
- Modify: `web-control/app.js`
- Modify: `web-control/index.html`
- Modify: `web-control/styles.css`

**Step 1: Write the failing test**

Document a manual web checklist in `docs/plans/2026-04-03-agenthub-relay-v1-manual-checklist.md` for:

- pairing or token bootstrap
- host list
- session list
- session switch
- turn send

**Step 2: Run test to verify it fails**

Run: `npm run build`
Expected: FAIL after introducing relay-specific UI/state references that do not yet exist

**Step 3: Write minimal implementation**

Update the web control app to:

- use relay host/session APIs
- persist selected host and selected session
- stop assuming a single global bridge token

**Step 4: Run test to verify it passes**

Run: `npm run build`
Expected: PASS

**Step 5: Commit**

```bash
git add web-control docs/plans/2026-04-03-agenthub-relay-v1-manual-checklist.md
git commit -m "feat: migrate web control to relay navigation"
```

### Task 7: Verify the Phase 1 vertical slice

**Files:**
- Modify: `docs/plans/2026-04-03-agenthub-relay-v1-manual-checklist.md`
- Modify: `docs/README.zh-CN.md`

**Step 1: Write the failing test**

Define a vertical-slice checklist that fails until all of the following work:

- desktop host registers
- pairing invite claims
- paired host list loads
- session list loads
- session switch works
- turn request reaches desktop and returns a response

**Step 2: Run test to verify it fails**

Run:

- `node --test relay/worker/test/*.test.js`
- `npm run build`
- `env DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project ios-app/LobsterMobile.xcodeproj -scheme LobsterMobile -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build`

Expected: At least one failure before final integration is complete

**Step 3: Write minimal implementation**

Finish the missing integration glue and update docs with real setup instructions.

**Step 4: Run test to verify it passes**

Run the same three commands
Expected: PASS

**Step 5: Commit**

```bash
git add docs
git commit -m "docs: finalize relay v1 setup and verification"
```
