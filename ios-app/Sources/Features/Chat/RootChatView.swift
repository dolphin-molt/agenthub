import SwiftUI
import UIKit

struct RootChatView: View {
    @ObservedObject var store: ChatStore
    @Environment(\.colorScheme) private var colorScheme
    @FocusState private var isComposerFocused: Bool
    @State private var didRunStartup = false

    var body: some View {
        ZStack(alignment: .leading) {
            backgroundGradient
                .ignoresSafeArea()

            backgroundAtmosphere
                .ignoresSafeArea()

            VStack(spacing: 14) {
                HeaderBar(
                    title: currentTitle,
                    subtitle: headerSubtitle,
                    isRelayMode: store.isRelayMode,
                    connectionState: store.connectionState,
                    currentCall: store.currentRelayCall,
                    onOpenHistory: openHistory,
                    onPrimaryAction: primaryAction,
                    onCallAction: callAction
                )

                if let currentCall = store.currentRelayCall {
                    RelayCallBanner(
                        call: currentCall,
                        effectiveMediaConfig: currentCall.effectiveMediaConfig(defaults: store.selectedHost?.mediaDefaults),
                        onAction: callAction
                    )
                }

                TimelinePane(
                    store: store,
                    onBackgroundTap: dismissComposerFromSurfaceTap
                )

                ComposerBar(
                    draft: $store.draft,
                    isFocused: $isComposerFocused,
                    isRelayMode: store.isRelayMode,
                    isSending: store.isSending,
                    connectionState: store.connectionState,
                    onSend: sendDraft
                )
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .padding(.horizontal, 16)
            .padding(.top, 10)
            .padding(.bottom, 10)

            if store.isShowingHistory {
                Color.black.opacity(0.18)
                    .ignoresSafeArea()
                    .onTapGesture(perform: closeHistory)

                HistoryDrawerView(store: store)
                    .transition(.move(edge: .leading).combined(with: .opacity))
            }

            if store.connectionState == .connecting {
                ConnectingOverlay(
                    isRelayMode: store.isRelayMode,
                    stage: store.connectionStage
                )
            }
        }
        .simultaneousGesture(
            TapGesture().onEnded {
                dismissComposerFromSurfaceTap()
            }
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .sheet(isPresented: $store.isShowingConnectionSheet) {
            ConnectionSheet(store: store)
                .presentationDetents([.medium, .large])
        }
        .task {
            guard !didRunStartup else { return }
            didRunStartup = true

            let hasRelay = store.connectionConfig.relay != nil
            let hasDirect = !store.connectionConfig.directBridge.token.isEmpty
            guard hasRelay || hasDirect else {
                store.isShowingConnectionSheet = true
                return
            }

            await store.connect()
        }
    }

    private var currentTitle: String {
        if store.isRelayMode {
            return store.selectedRelaySession?.title ?? store.selectedHost?.displayName ?? "Lobster"
        }

        return store.selectedThread?.thread.title ?? "Lobster"
    }

    private var headerSubtitle: String {
        if store.isRelayMode {
            return MessagePresentation.localizedHostSubtitle(host: store.selectedHost)
        }

        switch store.connectionState {
        case .connected:
            if let updatedAt = store.selectedThread?.thread.updatedAt,
               let formatted = MessagePresentation.formattedTimestamp(updatedAt) {
                return "Updated \(formatted)"
            }
            return "Direct bridge connected"
        case .connecting:
            return "Connecting..."
        case .failed:
            return "Connection issue"
        case .disconnected:
            return "Waiting to connect"
        }
    }

    private var backgroundGradient: LinearGradient {
        palette.backgroundGradient
    }

    private var backgroundAtmosphere: some View {
        Color.clear
    }

    private func openHistory() {
        withAnimation(.spring(response: 0.28, dampingFraction: 0.9)) {
            store.isShowingHistory = true
        }
    }

    private func closeHistory() {
        withAnimation(.spring(response: 0.28, dampingFraction: 0.9)) {
            store.isShowingHistory = false
        }
    }

    private func primaryAction() {
        if store.connectionState == .connected && !store.isRelayMode {
            store.startNewConversation()
            isComposerFocused = true
            return
        }

        store.isShowingConnectionSheet = true
    }

    private func sendDraft() {
        Task {
            await store.sendCurrentDraft()
        }
    }

    private func callAction() {
        Task {
            if store.currentRelayCall == nil {
                await store.startRelayAudioCall()
            } else {
                await store.endCurrentRelayCall()
            }
        }
    }

    private var palette: ChatChromePalette {
        ChatChromePresentation.palette(for: colorScheme)
    }

    private func dismissComposerFromSurfaceTap() {
        guard ChatInteractionPresentation.shouldDismissComposerOnBackgroundTap(isComposerFocused: isComposerFocused) else {
            return
        }

        isComposerFocused = false
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}

private struct HeaderBar: View {
    @Environment(\.colorScheme) private var colorScheme
    let title: String
    let subtitle: String
    let isRelayMode: Bool
    let connectionState: ChatStore.ConnectionState
    let currentCall: RelayCallSummary?
    let onOpenHistory: () -> Void
    let onPrimaryAction: () -> Void
    let onCallAction: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onOpenHistory) {
                Image(systemName: "sidebar.leading")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(palette.primaryTextColor)
                    .frame(width: 38, height: 38)
            }
            .buttonStyle(.plain)

            VStack(spacing: 2) {
                Text(title)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(palette.primaryTextColor)
                    .lineLimit(1)

                Text(subtitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(palette.secondaryTextColor)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)

            HStack(spacing: 12) {
                if isRelayMode {
                    Button(action: onCallAction) {
                        Image(systemName: callIconName)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(callIconColor)
                            .frame(width: 38, height: 38)
                    }
                    .buttonStyle(.plain)
                }

                Button(action: onPrimaryAction) {
                    Image(systemName: primaryIconName)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(palette.primaryTextColor)
                        .frame(width: 38, height: 38)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 6)
    }

    private var primaryIconName: String {
        if connectionState == .connected && !isRelayMode {
            return "square.and.pencil"
        }
        return "link.badge.plus"
    }

    private var callIconName: String {
        currentCall == nil ? "phone" : "phone.down.fill"
    }

    private var callIconColor: Color {
        currentCall == nil ? Color.accentColor : Color.red
    }

    private var palette: ChatChromePalette {
        ChatChromePresentation.palette(for: colorScheme)
    }
}

private struct RelayCallBanner: View {
    @Environment(\.colorScheme) private var colorScheme
    let call: RelayCallSummary
    let effectiveMediaConfig: RelayMediaConfig?
    let onAction: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: call.state == .live ? "waveform" : "phone")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.accentColor)

            VStack(alignment: .leading, spacing: 3) {
                Text(statusText)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(palette.primaryTextColor)

                if let mediaSummaryText {
                    Text(mediaSummaryText)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(palette.secondaryTextColor)
                        .lineLimit(2)
                }
            }

            Spacer(minLength: 12)

            Button(call.state == .live ? "Hang up" : "End") {
                onAction()
            }
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(call.state == .live ? Color.red : palette.secondaryTextColor)
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(palette.surfaceColor, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(palette.inputStrokeColor, lineWidth: 1)
        }
    }

    private var statusText: String {
        switch call.state {
        case .dialing:
            return "Calling your local agent..."
        case .ringing:
            return "Call is ringing..."
        case .connecting:
            return "Connecting voice channel..."
        case .live:
            return "Voice call is live"
        case .ended:
            return "Call ended"
        case .failed:
            return "Call failed"
        case .idle:
            return "Voice call is idle"
        }
    }

    private var mediaSummaryText: String? {
        var parts: [String] = []
        if let voice = effectiveMediaConfig?.voice {
            parts.append("Voice \(voice.providerId)/\(voice.modelId)")
        }
        if let video = effectiveMediaConfig?.video {
            parts.append("Video \(video.providerId)/\(video.modelId)")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " | ")
    }

    private var palette: ChatChromePalette {
        ChatChromePresentation.palette(for: colorScheme)
    }
}

private struct TimelinePane: View {
    @ObservedObject var store: ChatStore
    let onBackgroundTap: () -> Void

    var body: some View {
        if store.isRelayMode {
            RelaySessionPane(
                session: store.selectedRelaySession,
                host: store.selectedHost,
                messages: store.selectedRelayMessages,
                isSending: store.isSending,
                showSendingIndicator: store.isSending && !store.selectedRelayHasAssistantPreview,
                onBackgroundTap: onBackgroundTap
            )
        } else {
            DirectTimelinePane(
                messages: store.selectedDirectMessages,
                isSending: store.isSending,
                onBackgroundTap: onBackgroundTap
            )
        }
    }
}

private struct DirectTimelinePane: View {
    let messages: [BridgeMessage]
    let isSending: Bool
    let onBackgroundTap: () -> Void

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    if !messages.isEmpty {
                        ForEach(messages) { message in
                            MessageRow(message: message)
                                .id(message.id)
                        }

                        if isSending {
                            RelaySendingRow()
                        }
                    } else {
                        EmptyConversationCard()
                    }
                }
                .padding(.vertical, 12)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .contentShape(Rectangle())
            .onTapGesture(perform: onBackgroundTap)
            .onChange(of: messages.count) { _, _ in
                if let lastID = messages.last?.id {
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo(lastID, anchor: .bottom)
                    }
                }
            }
        }
    }
}

private struct RelaySessionPane: View {
    let session: RelaySession?
    let host: RelayHost?
    let messages: [BridgeMessage]
    let isSending: Bool
    let showSendingIndicator: Bool
    let onBackgroundTap: () -> Void

    var body: some View {
        ScrollViewReader { proxy in
        ScrollView {
            LazyVStack(spacing: 12) {
                    if messages.isEmpty {
                        if let session {
                            RelayConversationHint(session: session, host: host, isSending: isSending)
                        } else {
                            RelayEmptyState()
                        }
                    } else {
                        ForEach(messages) { message in
                            MessageRow(message: message)
                                .id(message.id)
                        }

                        if showSendingIndicator {
                            RelaySendingRow()
                        }
                    }
                }
                .padding(.vertical, 12)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .contentShape(Rectangle())
            .onTapGesture(perform: onBackgroundTap)
            .onChange(of: messages.count) { _, _ in
                if let lastID = messages.last?.id {
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo(lastID, anchor: .bottom)
                    }
                }
            }
        }
    }
}

private struct DayChip: View {
    @Environment(\.colorScheme) private var colorScheme
    var label: String = "Today"

    var body: some View {
        Text(label)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(palette.secondaryTextColor)
            .padding(.horizontal, 18)
            .padding(.vertical, 8)
            .background(palette.chipColor, in: Capsule())
            .frame(maxWidth: .infinity)
    }

    private var palette: ChatChromePalette {
        ChatChromePresentation.palette(for: colorScheme)
    }
}

private struct ComposerBar: View {
    @Environment(\.colorScheme) private var colorScheme
    @Binding var draft: String
    @FocusState.Binding var isFocused: Bool
    let isRelayMode: Bool
    let isSending: Bool
    let connectionState: ChatStore.ConnectionState
    let onSend: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 10) {
                TextField(
                    isRelayMode ? "Message dolphin..." : "Send message...",
                    text: $draft,
                    axis: .vertical
                )
                .focused($isFocused)
                .font(.system(size: 16))
                .foregroundStyle(palette.primaryTextColor)
                .lineLimit(1 ... ComposerPresentation.maxLineCount)
                .textFieldStyle(.plain)
                .padding(.vertical, ComposerPresentation.textVerticalInset)

                Button(action: onSend) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: ComposerPresentation.buttonIconSize, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(
                            width: ComposerPresentation.buttonDiameter,
                            height: ComposerPresentation.buttonDiameter
                        )
                        .background(buttonBackgroundColor, in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(isSendDisabled)
            }

            if case .failed(let message) = connectionState {
                Text(message)
                    .font(.system(size: 12))
                    .foregroundStyle(.red)
            }
        }
        .padding(.horizontal, ComposerPresentation.horizontalPadding)
        .padding(.vertical, ComposerPresentation.verticalPadding)
        .background(palette.surfaceColor, in: RoundedRectangle(cornerRadius: ComposerPresentation.cornerRadius, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: ComposerPresentation.cornerRadius, style: .continuous)
                .stroke(palette.inputStrokeColor, lineWidth: 1)
        }
    }

    private var isSendDisabled: Bool {
        draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending
    }

    private var buttonBackgroundColor: Color {
        isSendDisabled
            ? palette.composerButtonDisabledColor
            : palette.composerButtonEnabledColor
    }

    private var palette: ChatChromePalette {
        ChatChromePresentation.palette(for: colorScheme)
    }
}

private struct RelayEmptyState: View {
    @Environment(\.colorScheme) private var colorScheme
    var body: some View {
        EmptyStateCard {
            Circle()
                .fill(palette.accentFillColor)
                .frame(width: 56, height: 56)
                .overlay {
                    Image(systemName: "link")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(Color.accentColor)
                }

            Text("Select a paired session")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(palette.primaryTextColor)

            Text("Finish pairing, pick a host, then choose a conversation.")
                .multilineTextAlignment(.center)
                .font(.system(size: 14))
                .foregroundStyle(palette.secondaryTextColor)
        }
    }

    private var palette: ChatChromePalette {
        ChatChromePresentation.palette(for: colorScheme)
    }
}

private struct RelayConversationHint: View {
    @Environment(\.colorScheme) private var colorScheme
    let session: RelaySession
    let host: RelayHost?
    let isSending: Bool

    var body: some View {
        EmptyStateCard {
            Circle()
                .fill(palette.accentFillColor)
                .frame(width: 56, height: 56)
                .overlay {
                    Image(systemName: isSending ? "hourglass" : "ellipsis.message")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(Color.accentColor)
                }

            Text(isSending ? "正在等待回复" : "Start the conversation")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(palette.primaryTextColor)

            VStack(spacing: 6) {
                Text(session.title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(palette.primaryTextColor)

                Text("\(host?.displayName ?? session.hostId) · \(session.primaryAgentId ?? "dolphin")")
                    .font(.system(size: 13))
                    .foregroundStyle(palette.secondaryTextColor)
            }
            .multilineTextAlignment(.center)

            Text(isSending ? "dolphin is preparing a reply." : "Send the first message to your local agent.")
                .multilineTextAlignment(.center)
                .font(.system(size: 14))
                .foregroundStyle(palette.secondaryTextColor)
        }
    }

    private var palette: ChatChromePalette {
        ChatChromePresentation.palette(for: colorScheme)
    }
}

private struct RelaySendingRow: View {
    @Environment(\.colorScheme) private var colorScheme
    var body: some View {
        HStack {
            HStack(spacing: 10) {
                ProgressView()
                    .progressViewStyle(.circular)
                Text("dolphin is replying...")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(palette.secondaryTextColor)
            }
            .padding(.horizontal, 2)
            .padding(.vertical, 6)

            Spacer(minLength: 32)
        }
    }

    private var palette: ChatChromePalette {
        ChatChromePresentation.palette(for: colorScheme)
    }
}

private struct EmptyConversationCard: View {
    @Environment(\.colorScheme) private var colorScheme
    var body: some View {
        EmptyStateCard {
            Circle()
                .fill(palette.accentFillColor)
                .frame(width: 56, height: 56)
                .overlay {
                    Text("L")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(Color.accentColor)
                }

            Text("开始一段新对话")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(palette.primaryTextColor)

            Text("Send the first message to begin.")
                .multilineTextAlignment(.center)
                .font(.system(size: 14))
                .foregroundStyle(palette.secondaryTextColor)
        }
    }

    private var palette: ChatChromePalette {
        ChatChromePresentation.palette(for: colorScheme)
    }
}

private struct EmptyStateCard<Content: View>: View {
    @Environment(\.colorScheme) private var colorScheme
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 12) {
            content
        }
        .padding(.horizontal, 28)
        .padding(.vertical, 28)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 22)
        .padding(.top, 56)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}

private struct ConnectingOverlay: View {
    @Environment(\.colorScheme) private var colorScheme
    let isRelayMode: Bool
    let stage: ConnectionProgressStage?

    var body: some View {
        VStack(spacing: 10) {
            ProgressView()
                .progressViewStyle(.circular)
            Text(stage?.title ?? fallbackTitle)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(palette.primaryTextColor)

            Text(stage?.detail ?? fallbackDetail)
                .multilineTextAlignment(.center)
                .font(.system(size: 13))
                .foregroundStyle(palette.secondaryTextColor)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 20)
        .background(palette.surfaceColor, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(palette.overlayDimColor.ignoresSafeArea())
    }

    private var fallbackTitle: String {
        isRelayMode ? "正在连接 Relay workspace" : "正在连接 Direct Bridge"
    }

    private var fallbackDetail: String {
        isRelayMode ? "请稍候，正在同步这台 Mac 的远程入口。" : "正在检查本机桥接入口和凭证。"
    }

    private var palette: ChatChromePalette {
        ChatChromePresentation.palette(for: colorScheme)
    }
}

private struct MessageRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let message: BridgeMessage

    var body: some View {
        HStack {
            if message.isAssistant {
                bubble
                Spacer(minLength: 32)
            } else {
                Spacer(minLength: 32)
                bubble
            }
        }
    }

    private var bubble: some View {
        VStack(alignment: message.isAssistant ? .leading : .trailing, spacing: 6) {
            Group {
                if message.isAssistant {
                    MessageBody(message: message)
                        .padding(.vertical, 4)
                } else {
                    MessageBody(message: message)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 14)
                        .background(palette.userBubbleColor, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                }
            }

            if let metadata = MessagePresentation.metadataText(for: message) {
                Text(metadata)
                    .lineLimit(1)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(palette.metadataTextColor)
            }
        }
        .frame(
            maxWidth: message.isAssistant ? .infinity : 290,
            alignment: message.isAssistant ? .leading : .trailing
        )
    }

    private var palette: ChatChromePalette {
        ChatChromePresentation.palette(for: colorScheme)
    }
}

private struct MessageBody: View {
    @Environment(\.colorScheme) private var colorScheme
    let message: BridgeMessage

    var body: some View {
        let preview = MessagePresentation.preview(for: message.content)

        Group {
            if preview.kind == .plain, let attributed = preview.attributed {
                Text(attributed)
                    .font(.system(size: 16))
                    .foregroundStyle(textColor)
                    .lineSpacing(3)
            } else {
                Text(preview.renderedText)
                    .font(.system(size: 16))
                    .foregroundStyle(textColor)
                    .lineSpacing(3)
            }
        }
        .multilineTextAlignment(.leading)
    }

    private var textColor: Color {
        if message.isAssistant {
            return palette.assistantTextColor
        }
        return palette.userBubbleTextColor
    }

    private var palette: ChatChromePalette {
        ChatChromePresentation.palette(for: colorScheme)
    }
}
