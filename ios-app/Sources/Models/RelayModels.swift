import Foundation

enum RelayPairingPayloadError: LocalizedError {
    case invalidURL
    case missingPayload
    case invalidPayload

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "配对链接无效。"
        case .missingPayload:
            return "配对链接里没有携带连接信息。"
        case .invalidPayload:
            return "配对链接解析失败。"
        }
    }
}

struct RelayPairingPayload: Codable, Equatable {
    let v: Int
    let relayBaseURL: String
    let hostId: String
    let inviteId: String
    let code: String
    let expiresAt: String

    private enum CodingKeys: String, CodingKey {
        case v
        case relayBaseURL = "relayBaseUrl"
        case hostId
        case inviteId
        case code
        case expiresAt
    }

    static func parse(from input: String) throws -> RelayPairingPayload {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: trimmed) else {
            throw RelayPairingPayloadError.invalidURL
        }

        let fragment = components.fragment ?? ""
        let fragmentPairingValue = fragment
            .split(separator: "&")
            .compactMap { item -> String? in
                let parts = item.split(separator: "=", maxSplits: 1).map(String.init)
                guard parts.count == 2, parts[0] == "pairing" else {
                    return nil
                }
                return parts[1]
            }
            .first
        let queryPairingValue = components.queryItems?
            .first(where: { $0.name == "pairing" })?
            .value
        let pairingValue = queryPairingValue ?? fragmentPairingValue

        guard let pairingValue, !pairingValue.isEmpty else {
            throw RelayPairingPayloadError.missingPayload
        }

        guard
            let data = Data(base64URLEncoded: pairingValue),
            let payload = try? JSONDecoder().decode(RelayPairingPayload.self, from: data)
        else {
            throw RelayPairingPayloadError.invalidPayload
        }

        return payload
    }
}

struct RelayHost: Codable, Equatable, Hashable, Identifiable {
    let hostId: String
    let displayName: String
    let status: String
    let lastSeenAt: String
    let capabilities: [String]
    let mediaDefaults: RelayMediaConfig?
    let activeCall: RelayCallSummary?

    init(
        hostId: String,
        displayName: String,
        status: String,
        lastSeenAt: String,
        capabilities: [String],
        mediaDefaults: RelayMediaConfig? = nil,
        activeCall: RelayCallSummary? = nil
    ) {
        self.hostId = hostId
        self.displayName = displayName
        self.status = status
        self.lastSeenAt = lastSeenAt
        self.capabilities = capabilities
        self.mediaDefaults = mediaDefaults
        self.activeCall = activeCall
    }

    var id: String {
        hostId
    }
}

enum RelayCallMode: String, Codable, Equatable, Hashable {
    case audio
    case video
    case cameraShare = "camera-share"
}

enum RelayCallState: String, Codable, Equatable, Hashable {
    case idle
    case dialing
    case ringing
    case connecting
    case live
    case ended
    case failed
}

struct RelayModelSelection: Codable, Equatable, Hashable {
    let providerId: String
    let modelId: String
}

struct RelayMediaConfig: Codable, Equatable, Hashable {
    let voice: RelayModelSelection?
    let video: RelayModelSelection?

    func merging(with fallback: RelayMediaConfig?) -> RelayMediaConfig? {
        let merged = RelayMediaConfig(
            voice: voice ?? fallback?.voice,
            video: video ?? fallback?.video
        )
        return merged.voice == nil && merged.video == nil ? nil : merged
    }
}

struct RelayCallSummary: Codable, Equatable, Hashable, Identifiable {
    let callId: String
    let hostId: String
    let sessionId: String?
    let clientId: String
    let mode: RelayCallMode
    let state: RelayCallState
    let createdAt: String
    let updatedAt: String
    let mediaConfig: RelayMediaConfig?

    init(
        callId: String,
        hostId: String,
        sessionId: String?,
        clientId: String,
        mode: RelayCallMode,
        state: RelayCallState,
        createdAt: String,
        updatedAt: String,
        mediaConfig: RelayMediaConfig? = nil
    ) {
        self.callId = callId
        self.hostId = hostId
        self.sessionId = sessionId
        self.clientId = clientId
        self.mode = mode
        self.state = state
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.mediaConfig = mediaConfig
    }

    var id: String {
        callId
    }

    func effectiveMediaConfig(defaults: RelayMediaConfig?) -> RelayMediaConfig? {
        mediaConfig?.merging(with: defaults) ?? defaults
    }
}

struct RelaySession: Codable, Equatable, Hashable, Identifiable {
    let sessionId: String
    let hostId: String
    let title: String
    let summary: String
    let updatedAt: String
    let primaryAgentId: String?
    let state: String

    var id: String {
        sessionId
    }
}

struct RelayWorkspaceState: Codable, Equatable {
    let relayBaseURL: String
    let clientId: String
    private(set) var hosts: [RelayHost] = []
    private(set) var sessionsByHost: [String: [RelaySession]] = [:]
    private(set) var selectedHostId: String?
    private(set) var selectedSessionId: String?

    init(
        relayBaseURL: String,
        clientId: String,
        hosts: [RelayHost] = [],
        sessionsByHost: [String: [RelaySession]] = [:],
        selectedHostId: String? = nil,
        selectedSessionId: String? = nil
    ) {
        self.relayBaseURL = relayBaseURL
        self.clientId = clientId
        self.hosts = hosts
        self.sessionsByHost = sessionsByHost
        self.selectedHostId = selectedHostId
        self.selectedSessionId = selectedSessionId
    }

    var selectedHost: RelayHost? {
        guard let selectedHostId else {
            return nil
        }
        return hosts.first(where: { $0.hostId == selectedHostId })
    }

    var sessions: [RelaySession] {
        guard let selectedHostId else {
            return []
        }
        return sessionsByHost[selectedHostId] ?? []
    }

    var selectedSession: RelaySession? {
        guard let selectedSessionId else {
            return nil
        }
        return sessions.first(where: { $0.sessionId == selectedSessionId })
    }

    mutating func applyHosts(_ nextHosts: [RelayHost]) {
        hosts = nextHosts

        if let selectedHostId,
           nextHosts.contains(where: { $0.hostId == selectedHostId }) {
            selectHost(selectedHostId)
            return
        }

        selectedHostId = nextHosts.first?.hostId
        selectedSessionId = nil
    }

    mutating func applySessions(_ nextSessions: [RelaySession], for hostId: String) {
        sessionsByHost[hostId] = nextSessions

        guard selectedHostId == hostId else {
            return
        }

        if let selectedSessionId,
           nextSessions.contains(where: { $0.sessionId == selectedSessionId }) {
            return
        }

        selectedSessionId = nextSessions.first?.sessionId
    }

    mutating func selectHost(_ hostId: String) {
        guard hosts.contains(where: { $0.hostId == hostId }) else {
            return
        }

        selectedHostId = hostId
        selectedSessionId = sessionsByHost[hostId]?.first?.sessionId
    }

    mutating func selectSession(_ sessionId: String) {
        guard sessions.contains(where: { $0.sessionId == sessionId }) else {
            return
        }
        selectedSessionId = sessionId
    }

    mutating func applyActiveCall(_ call: RelayCallSummary?) {
        guard let targetHostId = call?.hostId ?? selectedHostId else {
            return
        }

        hosts = hosts.map { host in
            guard host.hostId == targetHostId else {
                return host
            }

            let nextActiveCall: RelayCallSummary?
            if let call, call.state != .ended, call.state != .failed {
                nextActiveCall = call
            } else {
                nextActiveCall = nil
            }

            return RelayHost(
                hostId: host.hostId,
                displayName: host.displayName,
                status: host.status,
                lastSeenAt: host.lastSeenAt,
                capabilities: host.capabilities,
                activeCall: nextActiveCall
            )
        }
    }
}

struct RelayTurn: Codable, Equatable {
    let turnId: String
    let hostId: String
    let clientId: String
    let sessionId: String
    let message: String
    let status: String
    let createdAt: String
    let claimedAt: String?
    let completedAt: String?
    let runtimeSessionId: String?
    let agentId: String?
    let userMessage: BridgeMessage?
    let assistantMessage: BridgeMessage?
    let error: String?

    var isTerminal: Bool {
        status == "completed" || status == "failed"
    }
}

struct RelayTurnEnvelopeResponse: Decodable {
    let ok: Bool
    let turn: RelayTurn
}

struct RelayCallEnvelopeResponse: Decodable {
    let ok: Bool
    let call: RelayCallSummary?
}

func mergeRelayMessages(existing: [BridgeMessage], turn: RelayTurn) -> [BridgeMessage] {
    var ordered: [BridgeMessage] = []
    var indexByID: [String: Int] = [:]

    func upsert(_ message: BridgeMessage) {
        if let index = indexByID[message.id] {
            ordered[index] = message
            return
        }

        indexByID[message.id] = ordered.count
        ordered.append(message)
    }

    existing.forEach(upsert)

    if let userMessage = turn.userMessage {
        upsert(userMessage)
    }

    if let assistantMessage = turn.assistantMessage {
        upsert(assistantMessage)
    }

    return ordered.sorted { lhs, rhs in
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

private extension Data {
    init?(base64URLEncoded value: String) {
        var normalized = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")

        let remainder = normalized.count % 4
        if remainder > 0 {
            normalized += String(repeating: "=", count: 4 - remainder)
        }

        self.init(base64Encoded: normalized)
    }
}
