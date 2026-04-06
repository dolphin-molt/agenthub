import Foundation

actor AgentHubBridgeClient {
    enum ConnectionState: String {
        case disconnected
        case connecting
        case connected
        case error
    }

    struct QuickChatEnvelope: Codable {
        let message: String
        let channel: String
        let createdAt: Date
    }

    func enqueueQuickChat(_ message: String) async throws {
        let payload = QuickChatEnvelope(
            message: message,
            channel: "companion-quick-chat",
            createdAt: Date()
        )

        _ = try JSONEncoder().encode(payload)
        try await Task.sleep(for: .milliseconds(120))
    }
}
