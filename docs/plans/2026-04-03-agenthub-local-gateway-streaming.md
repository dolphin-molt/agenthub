# AgentHub Local Gateway And Relay Streaming Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Collapse the current local relay stack into one desktop gateway process, add relay text streaming to iOS, and leave the repo with a reproducible local packaging path for device testing.

**Architecture:** Keep Cloudflare as the public relay control plane, but stop treating `relay-agent` and `remote-bridge-worker` as separate long-term local services. The desktop runtime path becomes one `Local Gateway` process that owns direct HTTP compatibility, relay host sync, relay turn execution, and local persistence. Relay streaming lands first as partial turn progress persisted in the relay store plus frequent client-side updates, which is enough to deliver a visibly streaming mobile experience without introducing a second transport now.

**Tech Stack:** Tauri Rust commands, Node.js local gateway script, Cloudflare Workers + D1, SwiftUI, existing AgentHub collaboration state, `xcodebuild`, Node built-in test runner

### Task 1: Unify local gateway ownership

**Files:**
- Modify: `src-tauri/scripts/remote-bridge-worker.mjs`
- Modify: `src-tauri/scripts/relay-agent.mjs`
- Modify: `src-tauri/src/commands/remote.rs`
- Modify: `src-tauri/src/commands/relay.rs`
- Test: `src-tauri/scripts/__tests__/relay-agent-config.test.mjs`

**Step 1: Write the failing test**

Add a Node test that expects:
- relay turn execution can be performed without issuing an HTTP request back into the local bridge
- relay host sync and relay turn polling can be driven by one gateway loop

**Step 2: Run test to verify it fails**

Run: `node --test src-tauri/scripts/__tests__/relay-agent-config.test.mjs`
Expected: FAIL because relay execution still requires the separate bridge HTTP hop

**Step 3: Write minimal implementation**

Implement:
- shared local turn execution inside `remote-bridge-worker.mjs`
- optional relay sync + claim loop inside the same process
- Rust command changes so relay start/stop manages the same local gateway process instead of a second long-lived worker

**Step 4: Run test to verify it passes**

Run: `node --test src-tauri/scripts/__tests__/relay-agent-config.test.mjs`
Expected: PASS

### Task 2: Add relay turn progress persistence

**Files:**
- Modify: `relay/worker/src/storage.js`
- Modify: `relay/worker/src/index.js`
- Modify: `relay/worker/test/storage.test.js`
- Modify: `relay/worker/test/http.test.js`

**Step 1: Write the failing test**

Add tests that expect:
- a host can post partial turn progress before completion
- `GET /api/clients/:clientId/turns/:turnId` returns the latest assistant preview while status is still active

**Step 2: Run test to verify it fails**

Run: `node --test relay/worker/test/storage.test.js relay/worker/test/http.test.js`
Expected: FAIL because the relay store only supports queued/claimed/completed turns

**Step 3: Write minimal implementation**

Implement:
- partial turn progress update in storage
- a progress endpoint on the worker
- turn status shape that exposes assistant preview during execution

**Step 4: Run test to verify it passes**

Run: `node --test relay/worker/test/storage.test.js relay/worker/test/http.test.js`
Expected: PASS

### Task 3: Surface streaming relay output in iOS

**Files:**
- Modify: `ios-app/Sources/Services/RelayClient.swift`
- Modify: `ios-app/Sources/Features/Chat/ChatStore.swift`
- Modify: `ios-app/Sources/Models/RelayModels.swift`
- Modify: `ios-app/Tests/RelayModelsTests.swift`

**Step 1: Write the failing test**

Add a model/state test that expects:
- repeated relay turn updates replace the same assistant message instead of appending duplicates
- the pending relay timeline can show user message plus partial assistant preview before completion

**Step 2: Run test to verify it fails**

Run: `xcrun swiftc ... RelayModelsTests.swift && xcrun simctl spawn booted /tmp/relay-models-tests`
Expected: FAIL because relay turns are only merged once at completion

**Step 3: Write minimal implementation**

Implement:
- relay progress polling in `RelayClient`
- streaming merge updates in `ChatStore`
- UI state that keeps the assistant row alive while progress arrives

**Step 4: Run test to verify it passes**

Run the same Swift test command
Expected: PASS

### Task 4: Verify packaging and local test path

**Files:**
- Modify: `ios-app/README.md`
- Optional create: `docs/plans/2026-04-03-agenthub-ios-local-packaging.md`

**Step 1: Write the checklist**

Document:
- required Apple/Xcode prerequisites
- simulator build path
- device signing requirements
- how the local gateway + relay should be started for on-device testing

**Step 2: Verify the build path**

Run:
- `xcodebuild ... build`
- if possible, `xcodebuild ... -destination 'generic/platform=iOS' build`

Expected: local packaging path is documented and reproducible
