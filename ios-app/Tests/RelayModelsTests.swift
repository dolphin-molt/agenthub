import Foundation

private func assert(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("Assertion failed: \(message)\n", stderr)
        exit(1)
    }
}

private func testParsesDesktopPairingURL() throws {
    let payload = """
    {
      "v": 1,
      "relayBaseUrl": "https://relay.example.workers.dev/api",
      "hostId": "host_alpha",
      "inviteId": "invite_123",
      "code": "PAIR-123456",
      "expiresAt": "2026-04-03T12:05:00.000Z"
    }
    """
    let encoded = Data(payload.utf8).base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
    let url = "https://relay.example.workers.dev/pair#pairing=\(encoded)"

    let pairing = try RelayPairingPayload.parse(from: url)

    assert(pairing.relayBaseURL == "https://relay.example.workers.dev/api", "relayBaseURL should decode from pairing link")
    assert(pairing.hostId == "host_alpha", "hostId should decode from pairing link")
    assert(pairing.code == "PAIR-123456", "pairing code should decode from pairing link")
}

private func testParsesCustomSchemePairingURL() throws {
    let payload = """
    {
      "v": 1,
      "relayBaseUrl": "https://relay.example.workers.dev/api",
      "hostId": "host_alpha",
      "inviteId": "invite_123",
      "code": "PAIR-123456",
      "expiresAt": "2026-04-03T12:05:00.000Z"
    }
    """
    let encoded = Data(payload.utf8).base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
    let url = "lobster://pair?pairing=\(encoded)"

    let pairing = try RelayPairingPayload.parse(from: url)

    assert(pairing.relayBaseURL == "https://relay.example.workers.dev/api", "relayBaseURL should decode from custom scheme link")
    assert(pairing.hostId == "host_alpha", "hostId should decode from custom scheme link")
    assert(pairing.code == "PAIR-123456", "pairing code should decode from custom scheme link")
}

private func testSelectsFirstHostAndSessionAfterRefresh() {
    let hostA = RelayHost(
        hostId: "host_alpha",
        displayName: "Work MacBook",
        status: "online",
        lastSeenAt: "2026-04-03T12:00:00.000Z",
        capabilities: ["chat"]
    )
    let hostB = RelayHost(
        hostId: "host_beta",
        displayName: "Home Mac mini",
        status: "online",
        lastSeenAt: "2026-04-03T12:01:00.000Z",
        capabilities: ["chat"]
    )
    let sessionA1 = RelaySession(
        sessionId: "session_alpha_1",
        hostId: "host_alpha",
        title: "Plan relay v1",
        summary: "Design and implementation work",
        updatedAt: "2026-04-03T12:02:00.000Z",
        primaryAgentId: "Claude Code",
        state: "active"
    )
    let sessionA2 = RelaySession(
        sessionId: "session_alpha_2",
        hostId: "host_alpha",
        title: "Fix iOS pairing",
        summary: "SwiftUI migration",
        updatedAt: "2026-04-03T12:03:00.000Z",
        primaryAgentId: "Codex CLI",
        state: "active"
    )
    let sessionB1 = RelaySession(
        sessionId: "session_beta_1",
        hostId: "host_beta",
        title: "Review roadmap",
        summary: "Relay follow-up",
        updatedAt: "2026-04-03T12:04:00.000Z",
        primaryAgentId: "OpenClaw",
        state: "active"
    )

    var workspace = RelayWorkspaceState(
        relayBaseURL: "https://relay.example.workers.dev/api",
        clientId: "client_ios"
    )

    workspace.applyHosts([hostA, hostB])
    assert(workspace.selectedHostId == "host_alpha", "first host should be selected by default")

    workspace.applySessions([sessionA1, sessionA2], for: "host_alpha")
    assert(workspace.selectedSessionId == "session_alpha_1", "first session should be selected when host sessions load")

    workspace.selectHost("host_beta")
    workspace.applySessions([sessionB1], for: "host_beta")
    assert(workspace.selectedHostId == "host_beta", "manual host switch should stick")
    assert(workspace.selectedSessionId == "session_beta_1", "selected session should switch with selected host")
}

private func testDecodesHostWithActiveAudioCall() throws {
    let json = """
    {
      "hostId": "host_alpha",
      "displayName": "Work MacBook",
      "status": "online",
      "lastSeenAt": "2026-04-04T01:00:00.000Z",
      "capabilities": ["chat", "voice"],
      "mediaDefaults": {
        "voice": {
          "providerId": "volcengine",
          "modelId": "doubao-realtime-asr"
        },
        "video": {
          "providerId": "googleapis",
          "modelId": "gemini-2.5-flash"
        }
      },
      "activeCall": {
        "callId": "call_voice_1",
        "hostId": "host_alpha",
        "sessionId": "session_alpha_1",
        "clientId": "client_ios",
        "mode": "audio",
        "state": "live",
        "createdAt": "2026-04-04T01:00:02.000Z",
        "updatedAt": "2026-04-04T01:00:10.000Z",
        "mediaConfig": {
          "voice": {
            "providerId": "volcengine",
            "modelId": "doubao-realtime-asr"
          }
        }
      }
    }
    """

    let host = try JSONDecoder().decode(RelayHost.self, from: Data(json.utf8))

    assert(host.activeCall?.callId == "call_voice_1", "host should decode active call metadata")
    assert(host.activeCall?.mode == .audio, "voice call should decode as audio mode")
    assert(host.activeCall?.state == .live, "voice call should decode as live state")
    assert(host.mediaDefaults?.voice?.providerId == "volcengine", "host should decode default voice provider")
    assert(host.activeCall?.mediaConfig?.voice?.modelId == "doubao-realtime-asr", "call should decode voice model override")
}

private func testCallMediaConfigPrefersExplicitOverride() {
    let defaultMedia = RelayMediaConfig(
        voice: RelayModelSelection(providerId: "volcengine", modelId: "doubao-realtime-asr"),
        video: RelayModelSelection(providerId: "googleapis", modelId: "gemini-2.5-flash")
    )
    let overrideMedia = RelayMediaConfig(
        voice: RelayModelSelection(providerId: "bigmodel", modelId: "glm-asr-2512"),
        video: nil
    )
    let host = RelayHost(
        hostId: "host_alpha",
        displayName: "Work MacBook",
        status: "online",
        lastSeenAt: "2026-04-04T03:40:00.000Z",
        capabilities: ["chat", "voice", "video"],
        mediaDefaults: defaultMedia
    )
    let call = RelayCallSummary(
        callId: "call_voice_1",
        hostId: "host_alpha",
        sessionId: "session_alpha_1",
        clientId: "client_ios",
        mode: .audio,
        state: .live,
        createdAt: "2026-04-04T03:40:01.000Z",
        updatedAt: "2026-04-04T03:40:05.000Z",
        mediaConfig: overrideMedia
    )

    assert(call.effectiveMediaConfig(defaults: host.mediaDefaults)?.voice?.providerId == "bigmodel", "explicit call override should win over host default for voice")
    assert(call.effectiveMediaConfig(defaults: host.mediaDefaults)?.video?.modelId == "gemini-2.5-flash", "host default should fill missing video override")
}

private func testRelayCallStateOnlyAllowsKnownValues() throws {
    let live = try JSONDecoder().decode(
        RelayCallState.self,
        from: Data(#""live""#.utf8)
    )
    assert(live == .live, "known call state should decode")

    do {
        _ = try JSONDecoder().decode(
            RelayCallState.self,
            from: Data(#""processing""#.utf8)
        )
        assert(false, "unknown call state should fail decoding")
    } catch {
        assert(true, "unknown call state should fail decoding")
    }
}

private func testWorkspaceUpdatesActiveCallForSelectedHost() {
    let host = RelayHost(
        hostId: "host_alpha",
        displayName: "Work MacBook",
        status: "online",
        lastSeenAt: "2026-04-04T03:40:00.000Z",
        capabilities: ["chat", "voice"]
    )
    var workspace = RelayWorkspaceState(
        relayBaseURL: "https://relay.example.workers.dev/api",
        clientId: "client_ios"
    )
    workspace.applyHosts([host])

    workspace.applyActiveCall(
        RelayCallSummary(
            callId: "call_voice_1",
            hostId: "host_alpha",
            sessionId: "session_alpha_1",
            clientId: "client_ios",
            mode: .audio,
            state: .live,
            createdAt: "2026-04-04T03:40:01.000Z",
            updatedAt: "2026-04-04T03:40:05.000Z"
        )
    )

    assert(workspace.selectedHost?.activeCall?.callId == "call_voice_1", "workspace should surface the active call on the selected host")
    assert(workspace.selectedHost?.activeCall?.state == .live, "workspace should refresh active call state")
}

private func testWorkspaceClearsEndedActiveCall() {
    let liveCall = RelayCallSummary(
        callId: "call_voice_1",
        hostId: "host_alpha",
        sessionId: "session_alpha_1",
        clientId: "client_ios",
        mode: .audio,
        state: .live,
        createdAt: "2026-04-04T03:40:01.000Z",
        updatedAt: "2026-04-04T03:40:05.000Z"
    )
    let host = RelayHost(
        hostId: "host_alpha",
        displayName: "Work MacBook",
        status: "online",
        lastSeenAt: "2026-04-04T03:40:00.000Z",
        capabilities: ["chat", "voice"],
        activeCall: liveCall
    )
    var workspace = RelayWorkspaceState(
        relayBaseURL: "https://relay.example.workers.dev/api",
        clientId: "client_ios",
        hosts: [host],
        selectedHostId: "host_alpha"
    )

    workspace.applyActiveCall(
        RelayCallSummary(
            callId: "call_voice_1",
            hostId: "host_alpha",
            sessionId: "session_alpha_1",
            clientId: "client_ios",
            mode: .audio,
            state: .ended,
            createdAt: "2026-04-04T03:40:01.000Z",
            updatedAt: "2026-04-04T03:40:20.000Z"
        )
    )

    assert(workspace.selectedHost?.activeCall == nil, "ended call should clear the active call on the host")
}

private func testMergesRelayTurnMessagesWithoutDuplicates() {
    let existing = [
        BridgeMessage(
            id: "msg_user_1",
            role: "user",
            content: "hello",
            timestamp: "2026-04-03T12:00:00.000Z",
            agentId: "dolphin"
        )
    ]

    let turn = RelayTurn(
        turnId: "turn_1",
        hostId: "host_alpha",
        clientId: "client_ios",
        sessionId: "session_alpha_1",
        message: "hello",
        status: "completed",
        createdAt: "2026-04-03T12:00:00.000Z",
        claimedAt: "2026-04-03T12:00:01.000Z",
        completedAt: "2026-04-03T12:00:02.000Z",
        runtimeSessionId: "runtime_1",
        agentId: "dolphin",
        userMessage: BridgeMessage(
            id: "msg_user_1",
            role: "user",
            content: "hello",
            timestamp: "2026-04-03T12:00:00.000Z",
            agentId: "dolphin"
        ),
        assistantMessage: BridgeMessage(
            id: "msg_assistant_1",
            role: "assistant",
            content: "relay reply",
            timestamp: "2026-04-03T12:00:02.000Z",
            agentId: "dolphin"
        ),
        error: nil
    )

    let merged = mergeRelayMessages(existing: existing, turn: turn)

    assert(merged.count == 2, "relay turn merge should dedupe existing user message and append assistant reply")
    assert(merged[0].id == "msg_user_1", "existing user message should stay first")
    assert(merged[1].id == "msg_assistant_1", "assistant reply should append after user message")
}

private func testMergeRelayTurnReplacesInProgressAssistantPreview() {
    let existing = [
        BridgeMessage(
            id: "msg_user_1",
            role: "user",
            content: "hello",
            timestamp: "2026-04-03T12:00:00.000Z",
            agentId: nil
        ),
        BridgeMessage(
            id: "msg_assistant_preview",
            role: "assistant",
            content: "hello wor",
            timestamp: "2026-04-03T12:00:04.000Z",
            agentId: "dolphin"
        ),
    ]

    let turn = RelayTurn(
        turnId: "turn_preview",
        hostId: "host_alpha",
        clientId: "client_ios",
        sessionId: "session_alpha_1",
        message: "hello",
        status: "processing",
        createdAt: "2026-04-03T12:00:00.000Z",
        claimedAt: "2026-04-03T12:00:01.000Z",
        completedAt: nil,
        runtimeSessionId: "runtime_1",
        agentId: "dolphin",
        userMessage: nil,
        assistantMessage: BridgeMessage(
            id: "msg_assistant_preview",
            role: "assistant",
            content: "hello world from gateway",
            timestamp: "2026-04-03T12:00:05.000Z",
            agentId: "dolphin"
        ),
        error: nil
    )

    let merged = mergeRelayMessages(existing: existing, turn: turn)

    assert(merged.count == 2, "relay preview merge should update the assistant preview in place")
    assert(merged[1].id == "msg_assistant_preview", "assistant preview should keep the same id")
    assert(merged[1].content == "hello world from gateway", "assistant preview should refresh with latest streamed content")
}

private func testFormatsRelayMessageTimestampWithoutMilliseconds() {
    let timestamp = MessagePresentation.formattedTimestamp(
        "2026-04-03T13:04:43.288Z",
        referenceDate: Date(timeIntervalSince1970: 1_775_222_683),
        timeZone: TimeZone(secondsFromGMT: 8 * 3600) ?? .current,
        locale: Locale(identifier: "zh_CN")
    )

    assert(timestamp == "21:04", "timestamp should render as concise local time without milliseconds")
}

private func testHidesUserSenderLabelButKeepsAssistantLabel() {
    let user = BridgeMessage(
        id: "msg_user",
        role: "user",
        content: "hello",
        timestamp: "2026-04-03T13:04:43.288Z",
        agentId: "dolphin"
    )
    let assistant = BridgeMessage(
        id: "msg_assistant",
        role: "assistant",
        content: "hello back",
        timestamp: "2026-04-03T13:04:43.288Z",
        agentId: "dolphin"
    )

    assert(MessagePresentation.senderLabel(for: user) == nil, "user sender label should be hidden")
    assert(MessagePresentation.senderLabel(for: assistant) == "dolphin", "assistant sender label should remain visible")
}

private func testDetectsMarkdownPreview() {
    let preview = MessagePresentation.preview(for: """
    # Heading

    Here is **bold** text and a [link](https://example.com).
    """)

    assert(preview.kind == .markdown, "markdown content should be detected")
    assert(preview.renderedText.contains("Heading"), "markdown preview should preserve readable text")
    assert(preview.renderedText.contains("bold"), "markdown preview should include emphasis text")
}

private func testDetectsHTMLPreview() {
    let preview = MessagePresentation.preview(for: """
    <p>Hello <strong>relay</strong> <a href="https://example.com">preview</a></p>
    """)

    assert(preview.kind == .html, "html content should be detected")
    assert(preview.renderedText.contains("Hello"), "html preview should expose readable text")
    assert(preview.renderedText.contains("relay"), "html preview should preserve inner text")
}

private func testOptimisticPendingMessageAppearsInVisibleTimeline() {
    let committed = [
        BridgeMessage(
            id: "msg_assistant_1",
            role: "assistant",
            content: "Earlier reply",
            timestamp: "2026-04-03T13:03:00.000Z",
            agentId: "dolphin"
        )
    ]
    let pending = BridgeMessage.optimisticUserMessage(
        content: "hello from phone",
        createdAt: Date(timeIntervalSince1970: 1_775_222_700),
        agentId: nil
    )

    let visible = mergeVisibleMessages(existing: committed, pending: pending)

    assert(visible.count == 2, "visible timeline should append pending message")
    assert(visible[1].id == pending.id, "pending user message should appear at the end of the visible timeline")
    assert(visible[1].role == "user", "pending message should preserve the user role")
}

private func testComposerUsesCompactLayoutMetrics() {
    assert(ComposerPresentation.buttonDiameter == 38, "composer send button should stay compact")
    assert(ComposerPresentation.verticalPadding == 10, "composer container should use tighter vertical padding")
    assert(ComposerPresentation.maxLineCount == 4, "composer should stop expanding too tall")
}

private func testChatChromeUsesReadableContrastMetrics() {
    let light = ChatChromePresentation.palette(for: .light)
    let dark = ChatChromePresentation.palette(for: .dark)

    assert(!light.isDarkBackground, "light mode should keep a bright page background")
    assert(!light.usesLightForeground, "light mode should render with dark foreground text")
    assert(!light.showsAssistantBubble, "assistant replies should render inline in light mode")
    assert(light.composerUsesElevatedSurface, "light mode composer should still sit on a muted surface")

    assert(dark.isDarkBackground, "dark mode should use a true dark page background")
    assert(dark.usesLightForeground, "dark mode should switch to light foreground text")
    assert(!dark.showsAssistantBubble, "assistant replies should render inline in dark mode too")
    assert(dark.composerUsesElevatedSurface, "dark mode composer should remain readable against the black canvas")
}

private func testFocusedComposerCanDismissFromBackgroundTap() {
    assert(
        ChatInteractionPresentation.shouldDismissComposerOnBackgroundTap(isComposerFocused: true),
        "focused composer should dismiss when the timeline background is tapped"
    )
    assert(
        !ChatInteractionPresentation.shouldDismissComposerOnBackgroundTap(isComposerFocused: false),
        "background taps should do nothing when the composer is already unfocused"
    )
}

private func testConnectionProgressStagesUseFriendlyProductCopy() {
    assert(
        ConnectionProgressStage.claimingPairing.title == "正在连接这台 Mac",
        "pairing claim stage should use product-facing copy"
    )
    assert(
        ConnectionProgressStage.loadingHosts.detail.contains("主机"),
        "loading hosts stage should explain the current relay step"
    )
    assert(
        ConnectionProgressStage.loadingSessions.detail.contains("会话"),
        "loading sessions stage should explain the current relay step"
    )
}

private func testConnectionAttemptGateInvalidatesOlderAttempts() {
    var gate = ConnectionAttemptGate()
    let first = gate.begin()
    let second = gate.begin()

    assert(first != second, "new attempts should advance the connection generation")
    assert(!gate.isCurrent(first), "older attempts should become stale once a new attempt starts")
    assert(gate.isCurrent(second), "latest attempt should remain authoritative")
}

private func testRelayTransportUsesBoundedTimeout() {
    assert(
        RelayTransportDefaults.requestTimeoutSeconds <= 15,
        "relay requests should fail fast enough to avoid indefinite spinner states on device"
    )
    assert(
        RelayTransportDefaults.requestTimeoutSeconds >= 8,
        "relay requests still need enough time for cold starts and mobile networks"
    )
    assert(
        RelayTransportDefaults.maxRetryCount >= 2,
        "relay transport should retry transient mobile network failures"
    )
}

private func testRelayTransportRetriesTransientTimeouts() {
    let timeout = URLError(.timedOut)
    let reset = URLError(.networkConnectionLost)
    let badResponse = BridgeClientError.invalidResponse

    assert(
        shouldRetryTransportError(timeout),
        "timed out transport requests should be retryable"
    )
    assert(
        shouldRetryTransportError(reset),
        "network reset transport requests should be retryable"
    )
    assert(
        !shouldRetryTransportError(badResponse),
        "decoded server responses should not be retried blindly"
    )
}

@main
struct RelayModelsTestsRunner {
    static func main() throws {
        try testParsesDesktopPairingURL()
        try testParsesCustomSchemePairingURL()
        testSelectsFirstHostAndSessionAfterRefresh()
        try testDecodesHostWithActiveAudioCall()
        testCallMediaConfigPrefersExplicitOverride()
        try testRelayCallStateOnlyAllowsKnownValues()
        testWorkspaceUpdatesActiveCallForSelectedHost()
        testWorkspaceClearsEndedActiveCall()
        testMergesRelayTurnMessagesWithoutDuplicates()
        testMergeRelayTurnReplacesInProgressAssistantPreview()
        testFormatsRelayMessageTimestampWithoutMilliseconds()
        testHidesUserSenderLabelButKeepsAssistantLabel()
        testDetectsMarkdownPreview()
        testDetectsHTMLPreview()
        testOptimisticPendingMessageAppearsInVisibleTimeline()
        testComposerUsesCompactLayoutMetrics()
        testChatChromeUsesReadableContrastMetrics()
        testFocusedComposerCanDismissFromBackgroundTap()
        testConnectionProgressStagesUseFriendlyProductCopy()
        testConnectionAttemptGateInvalidatesOlderAttempts()
        testRelayTransportUsesBoundedTimeout()
        testRelayTransportRetriesTransientTimeouts()
        print("RelayModelsTests passed")
    }
}
