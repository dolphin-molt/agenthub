import Foundation
import SwiftUI
import UIKit

struct BridgeHealth: Decodable {
    let ok: Bool
    let threads: Int
}

struct ThreadSummary: Decodable, Identifiable, Hashable {
    let id: String
    let title: String?
    let goal: String?
    let primaryAgentId: String?
    let latestMessagePreview: String?
    let updatedAt: String?
}

struct ThreadEnvelope: Decodable {
    let thread: ThreadSummary
    let messages: [BridgeMessage]
}

struct BridgeMessage: Codable, Identifiable, Hashable {
    let id: String
    let role: String
    let content: String
    let timestamp: String?
    let agentId: String?

    var isAssistant: Bool {
        role == "assistant"
    }
}

extension BridgeMessage {
    static func optimisticUserMessage(
        content: String,
        createdAt: Date = Date(),
        agentId: String? = nil
    ) -> BridgeMessage {
        BridgeMessage(
            id: "pending_\(UUID().uuidString.lowercased())",
            role: "user",
            content: content,
            timestamp: optimisticTimestampFormatter.string(from: createdAt),
            agentId: agentId
        )
    }

    private static let optimisticTimestampFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

struct ThreadsResponse: Decodable {
    let threads: [ThreadSummary]
}

struct TurnResponse: Decodable {
    let ok: Bool?
    let threadId: String
}

enum ConnectionMode: String, Codable, Equatable {
    case relay
    case direct
}

struct BridgeConfig: Codable, Equatable {
    var baseURL: String
    var token: String

    static let `default` = BridgeConfig(
        baseURL: "https://control.nanobanani.app/api",
        token: ""
    )
}

struct RelayClientConfig: Codable, Equatable {
    var relayBaseURL: String
    var clientId: String
    var selectedHostId: String?
    var selectedSessionId: String?
}

struct MobileConnectionConfig: Codable, Equatable {
    var preferredMode: ConnectionMode
    var directBridge: BridgeConfig
    var relay: RelayClientConfig?

    static let `default` = MobileConnectionConfig(
        preferredMode: .relay,
        directBridge: .default,
        relay: nil
    )
}

enum ConnectionProgressStage: Equatable {
    case checkingDirectHealth
    case claimingPairing
    case loadingHosts
    case loadingSessions

    var title: String {
        switch self {
        case .checkingDirectHealth:
            return "正在检查本地连接"
        case .claimingPairing:
            return "正在连接这台 Mac"
        case .loadingHosts:
            return "正在同步主机列表"
        case .loadingSessions:
            return "正在加载会话"
        }
    }

    var detail: String {
        switch self {
        case .checkingDirectHealth:
            return "确认 Direct Bridge 在线并且凭证可用。"
        case .claimingPairing:
            return "正在领取桌面端刚生成的配对邀请。"
        case .loadingHosts:
            return "正在从云端 Relay 拉取这次配对后的主机状态。"
        case .loadingSessions:
            return "正在读取这台 Mac 当前可恢复的会话。"
        }
    }
}

struct ConnectionAttemptGate: Equatable {
    private(set) var currentGeneration: Int = 0

    mutating func begin() -> Int {
        currentGeneration += 1
        return currentGeneration
    }

    func isCurrent(_ generation: Int) -> Bool {
        generation == currentGeneration
    }
}

enum RelayTransportDefaults {
    static let requestTimeoutSeconds: TimeInterval = 12
    static let maxRetryCount = 2
    static let retryBackoffNanoseconds: UInt64 = 800_000_000
}

struct RelayPairingClaim: Decodable, Equatable {
    let hostId: String
    let clientId: String
    let claimedAt: String
}

struct RelayPairingClaimResponse: Decodable {
    let ok: Bool
    let pairing: RelayPairingClaim
}

struct RelayHostsResponse: Decodable {
    let ok: Bool
    let hosts: [RelayHost]
}

struct RelaySessionsResponse: Decodable {
    let ok: Bool
    let sessions: [RelaySession]
}

func mergeVisibleMessages(existing: [BridgeMessage], pending: BridgeMessage?) -> [BridgeMessage] {
    guard let pending else {
        return existing
    }

    return (existing + [pending]).sorted { lhs, rhs in
        let leftTimestamp = lhs.timestamp ?? ""
        let rightTimestamp = rhs.timestamp ?? ""

        if leftTimestamp == rightTimestamp {
            return lhs.id < rhs.id
        }

        if leftTimestamp.isEmpty {
            return false
        }

        if rightTimestamp.isEmpty {
            return true
        }

        return leftTimestamp < rightTimestamp
    }
}

enum MessageContentKind: Equatable {
    case plain
    case markdown
    case html
}

struct MessagePreview {
    let kind: MessageContentKind
    let attributed: AttributedString?
    let renderedText: String
}

enum ComposerPresentation {
    static let buttonDiameter: CGFloat = 38
    static let buttonIconSize: CGFloat = 15
    static let cornerRadius: CGFloat = 24
    static let horizontalPadding: CGFloat = 14
    static let verticalPadding: CGFloat = 10
    static let textVerticalInset: CGFloat = 2
    static let maxLineCount = 4
}

struct ChatChromePalette {
    let isDarkBackground: Bool
    let usesLightForeground: Bool
    let showsAssistantBubble: Bool
    let composerUsesElevatedSurface: Bool
    let backgroundGradient: LinearGradient
    let surfaceColor: Color
    let iconSurfaceColor: Color
    let chipColor: Color
    let inputFillColor: Color
    let inputStrokeColor: Color
    let primaryTextColor: Color
    let secondaryTextColor: Color
    let metadataTextColor: Color
    let userBubbleColor: Color
    let userBubbleTextColor: Color
    let assistantTextColor: Color
    let strokeColor: Color
    let overlayDimColor: Color
    let accentFillColor: Color
    let composerButtonEnabledColor: Color
    let composerButtonDisabledColor: Color
    let shadowOpacity: Double
}

enum ChatInteractionPresentation {
    static func shouldDismissComposerOnBackgroundTap(isComposerFocused: Bool) -> Bool {
        isComposerFocused
    }
}

enum ChatChromePresentation {
    static let backgroundGlowOpacity: Double = 0.2
    static let secondaryTextOpacity: Double = 0.78
    static let metadataTextOpacity: Double = 0.7
    static let surfaceOpacity: Double = 0.96
    static let emptyStateCardOpacity: Double = 0.94
    static let assistantBubbleOpacity: Double = 0.98
    static let accentFillOpacity: Double = 0.18
    static let shadowOpacity: Double = 0.08
    static let overlayDimOpacity: Double = 0.28
    static let composerButtonDisabledOpacity: Double = 0.22
    static let composerButtonEnabledOpacity: Double = 0.84
    static let backgroundTopLuminance: Double = 0.16
    static let backgroundBottomLuminance: Double = 0.28

    static var backgroundGradient: LinearGradient {
        LinearGradient(
            colors: [
                Color(red: 0.17, green: 0.16, blue: 0.15),
                Color(red: 0.32, green: 0.28, blue: 0.24),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    static var surfaceColor: Color {
        Color(red: 0.975, green: 0.968, blue: 0.956).opacity(surfaceOpacity)
    }

    static var assistantBubbleColor: Color {
        Color(red: 0.975, green: 0.97, blue: 0.962).opacity(assistantBubbleOpacity)
    }

    static var emptyStateCardColor: Color {
        Color(red: 0.955, green: 0.942, blue: 0.922).opacity(emptyStateCardOpacity)
    }

    static var strokeColor: Color {
        .black.opacity(0.08)
    }

    static var inputFillColor: Color {
        Color.black.opacity(0.08)
    }

    static var inputStrokeColor: Color {
        Color.black.opacity(0.06)
    }

    static var secondaryTextColor: Color {
        .black.opacity(secondaryTextOpacity)
    }

    static var metadataTextColor: Color {
        .black.opacity(metadataTextOpacity)
    }

    static var userBubbleGradient: LinearGradient {
        LinearGradient(
            colors: [
                Color(red: 0.98, green: 0.93, blue: 0.87),
                Color(red: 0.95, green: 0.88, blue: 0.81),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    static func palette(for colorScheme: ColorScheme) -> ChatChromePalette {
        switch colorScheme {
        case .dark:
            return ChatChromePalette(
                isDarkBackground: true,
                usesLightForeground: true,
                showsAssistantBubble: false,
                composerUsesElevatedSurface: true,
                backgroundGradient: LinearGradient(
                    colors: [
                        Color.black,
                        Color(red: 0.03, green: 0.03, blue: 0.04),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                ),
                surfaceColor: Color(red: 0.13, green: 0.13, blue: 0.14),
                iconSurfaceColor: Color(red: 0.15, green: 0.15, blue: 0.16),
                chipColor: Color(red: 0.14, green: 0.14, blue: 0.15),
                inputFillColor: Color(red: 0.16, green: 0.16, blue: 0.17),
                inputStrokeColor: Color.white.opacity(0.06),
                primaryTextColor: .white,
                secondaryTextColor: Color.white.opacity(0.68),
                metadataTextColor: Color.white.opacity(0.55),
                userBubbleColor: Color(red: 0.0, green: 0.42, blue: 0.15),
                userBubbleTextColor: .white,
                assistantTextColor: .white,
                strokeColor: Color.white.opacity(0.06),
                overlayDimColor: Color.black.opacity(0.46),
                accentFillColor: Color.accentColor.opacity(0.18),
                composerButtonEnabledColor: Color(red: 0.0, green: 0.76, blue: 0.29),
                composerButtonDisabledColor: Color.white.opacity(0.16),
                shadowOpacity: 0.0
            )
        default:
            return ChatChromePalette(
                isDarkBackground: false,
                usesLightForeground: false,
                showsAssistantBubble: false,
                composerUsesElevatedSurface: true,
                backgroundGradient: LinearGradient(
                    colors: [
                        Color(red: 0.986, green: 0.986, blue: 0.982),
                        Color(red: 0.982, green: 0.982, blue: 0.978),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                ),
                surfaceColor: Color(red: 0.94, green: 0.94, blue: 0.93),
                iconSurfaceColor: Color(red: 0.95, green: 0.95, blue: 0.945),
                chipColor: Color(red: 0.955, green: 0.955, blue: 0.95),
                inputFillColor: Color(red: 0.92, green: 0.92, blue: 0.91),
                inputStrokeColor: Color.black.opacity(0.05),
                primaryTextColor: Color(red: 0.07, green: 0.07, blue: 0.08),
                secondaryTextColor: Color.black.opacity(0.56),
                metadataTextColor: Color.black.opacity(0.44),
                userBubbleColor: Color(red: 0.84, green: 0.95, blue: 0.86),
                userBubbleTextColor: Color(red: 0.06, green: 0.23, blue: 0.13),
                assistantTextColor: Color(red: 0.07, green: 0.07, blue: 0.08),
                strokeColor: Color.black.opacity(0.06),
                overlayDimColor: Color.black.opacity(0.16),
                accentFillColor: Color.accentColor.opacity(0.12),
                composerButtonEnabledColor: Color(red: 0.0, green: 0.76, blue: 0.29),
                composerButtonDisabledColor: Color.black.opacity(0.14),
                shadowOpacity: 0.02
            )
        }
    }
}

enum MessagePresentation {
    static func preview(for source: String) -> MessagePreview {
        let kind = detectContentKind(source)
        let renderedText = renderedText(for: source, kind: kind)

        switch kind {
        case .plain:
            return MessagePreview(kind: .plain, attributed: nil, renderedText: renderedText)
        case .markdown:
            if let attributed = markdownAttributedString(for: source) {
                return MessagePreview(
                    kind: .markdown,
                    attributed: attributed,
                    renderedText: renderedText
                )
            }
        case .html:
            if let attributed = htmlAttributedString(for: source) {
                return MessagePreview(
                    kind: .html,
                    attributed: attributed,
                    renderedText: renderedText
                )
            }
        }

        return MessagePreview(kind: .plain, attributed: nil, renderedText: renderedText)
    }

    static func senderLabel(for message: BridgeMessage) -> String? {
        guard message.isAssistant else {
            return nil
        }

        let agentId = message.agentId?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let agentId, !agentId.isEmpty {
            return agentId
        }

        return "dolphin"
    }

    static func metadataText(
        for message: BridgeMessage,
        referenceDate: Date = Date(),
        timeZone: TimeZone = .current,
        locale: Locale = .current
    ) -> String? {
        let timestamp = formattedTimestamp(
            message.timestamp,
            referenceDate: referenceDate,
            timeZone: timeZone,
            locale: locale
        )
        let sender = senderLabel(for: message)

        switch (sender, timestamp) {
        case let (sender?, timestamp?):
            return "\(sender) · \(timestamp)"
        case let (sender?, nil):
            return sender
        case let (nil, timestamp?):
            return timestamp
        case (nil, nil):
            return nil
        }
    }

    static func formattedTimestamp(
        _ value: String?,
        referenceDate: Date = Date(),
        timeZone: TimeZone = .current,
        locale: Locale = .current
    ) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
            return nil
        }

        guard let date = parseISO8601(value) else {
            return nil
        }

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone

        let formatter = DateFormatter()
        formatter.timeZone = timeZone
        formatter.locale = locale
        formatter.dateFormat = calendar.isDate(date, inSameDayAs: referenceDate) ? "HH:mm" : "M月d日 HH:mm"
        return formatter.string(from: date)
    }

    static func localizedHostSubtitle(host: RelayHost?) -> String {
        guard let host else {
            return "Waiting to connect"
        }
        return "\(host.displayName) · \(localizedStatus(host.status))"
    }

    static func localizedStatus(_ rawStatus: String) -> String {
        switch rawStatus.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "online":
            return "在线"
        case "offline":
            return "离线"
        case "active":
            return "进行中"
        case "idle":
            return "空闲"
        default:
            return rawStatus
        }
    }

    private static func detectContentKind(_ source: String) -> MessageContentKind {
        let trimmed = source.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return .plain
        }

        if containsHTML(trimmed) {
            return .html
        }

        if containsMarkdown(trimmed) {
            return .markdown
        }

        return .plain
    }

    private static func markdownAttributedString(for source: String) -> AttributedString? {
        try? AttributedString(
            markdown: source,
            options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .full)
        )
    }

    private static func htmlAttributedString(for source: String) -> AttributedString? {
        guard let data = source.data(using: .utf8) else {
            return nil
        }

        guard
            let attributed = try? NSMutableAttributedString(
                data: data,
                options: [
                    .documentType: NSAttributedString.DocumentType.html,
                    .characterEncoding: String.Encoding.utf8.rawValue,
                ],
                documentAttributes: nil
            )
        else {
            return nil
        }

        normalizeHTMLAttributes(attributed)
        return try? AttributedString(attributed, including: \.uiKit)
    }

    private static func normalizeHTMLAttributes(_ attributed: NSMutableAttributedString) {
        let fullRange = NSRange(location: 0, length: attributed.length)

        attributed.enumerateAttribute(.font, in: fullRange) { value, range, _ in
            let traits = (value as? UIFont)?.fontDescriptor.symbolicTraits ?? []
            let replacement: UIFont

            if traits.contains(.traitBold) {
                replacement = .systemFont(ofSize: 16, weight: .semibold)
            } else if traits.contains(.traitItalic) {
                replacement = .italicSystemFont(ofSize: 16)
            } else {
                replacement = .systemFont(ofSize: 16)
            }

            attributed.addAttribute(.font, value: replacement, range: range)
        }

        attributed.addAttribute(.foregroundColor, value: UIColor.label, range: fullRange)
    }

    private static func containsHTML(_ source: String) -> Bool {
        source.range(of: #"<[A-Za-z][^>]*>"#, options: .regularExpression) != nil
    }

    private static func containsMarkdown(_ source: String) -> Bool {
        let blockPattern = #"(?m)^(#{1,6}\s|\-\s|\*\s|\d+\.\s|>\s|```)"#
        if source.range(of: blockPattern, options: .regularExpression) != nil {
            return true
        }

        let inlinePatterns = [
            #"\[[^\]]+\]\([^)]+\)"#,
            #"\*\*[^*]+\*\*"#,
            #"__[^_]+__"#,
            #"`[^`]+`"#,
        ]

        return inlinePatterns.contains { pattern in
            source.range(of: pattern, options: .regularExpression) != nil
        }
    }

    private static func renderedText(for source: String, kind: MessageContentKind) -> String {
        switch kind {
        case .plain:
            return normalizedRenderedText(source)
        case .markdown:
            return normalizedRenderedText(renderMarkdownToText(source))
        case .html:
            return normalizedRenderedText(renderHTMLToText(source))
        }
    }

    private static func renderMarkdownToText(_ source: String) -> String {
        source
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: #"(?m)^#{1,6}\s*"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"(?m)^>\s?"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"```([\s\S]*?)```"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: #"`([^`]+)`"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: #"\[([^\]]+)\]\([^)]+\)"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: #"\*\*([^*]+)\*\*"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: #"__([^_]+)__"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: #"(?m)^(\s*[-*+]\s+)"#, with: "- ", options: .regularExpression)
    }

    private static func renderHTMLToText(_ source: String) -> String {
        source
            .replacingOccurrences(of: #"(?i)<br\s*/?>"#, with: "\n", options: .regularExpression)
            .replacingOccurrences(of: #"(?i)</(p|div|h[1-6]|ul|ol)>"#, with: "\n", options: .regularExpression)
            .replacingOccurrences(of: #"(?i)<li[^>]*>"#, with: "- ", options: .regularExpression)
            .replacingOccurrences(of: #"(?i)</li>"#, with: "\n", options: .regularExpression)
            .replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&#39;", with: "'")
    }

    private static func normalizedRenderedText(_ source: String) -> String {
        let lines = source
            .replacingOccurrences(of: "\r\n", with: "\n")
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { line in
                line.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
            }

        var renderedLines: [String] = []
        var previousWasBlank = false

        for line in lines {
            if line.isEmpty {
                if !previousWasBlank, !renderedLines.isEmpty {
                    renderedLines.append("")
                }
                previousWasBlank = true
                continue
            }

            renderedLines.append(line)
            previousWasBlank = false
        }

        return renderedLines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func parseISO8601(_ value: String) -> Date? {
        if let date = fractionalISOFormatter.date(from: value) {
            return date
        }
        return plainISOFormatter.date(from: value)
    }

    private static let fractionalISOFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let plainISOFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
}
