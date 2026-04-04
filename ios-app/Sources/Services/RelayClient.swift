import Foundation

struct RelayClient {
    let relayBaseURL: String

    func claimInvite(code: String, clientId: String, claimedAt: String) async throws -> RelayPairingClaim {
        struct Payload: Encodable {
            let code: String
            let clientId: String
            let claimedAt: String
        }

        let response: RelayPairingClaimResponse = try await send(
            path: "/pairing/invites/claim",
            method: "POST",
            body: Payload(code: code, clientId: clientId, claimedAt: claimedAt)
        )
        return response.pairing
    }

    func listHosts(clientId: String) async throws -> [RelayHost] {
        let encodedClientId = clientId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? clientId
        let response: RelayHostsResponse = try await send(
            path: "/clients/\(encodedClientId)/hosts",
            method: "GET",
            body: Optional<String>.none
        )
        return response.hosts
    }

    func listSessions(hostId: String) async throws -> [RelaySession] {
        let encodedHostId = hostId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? hostId
        let response: RelaySessionsResponse = try await send(
            path: "/hosts/\(encodedHostId)/sessions",
            method: "GET",
            body: Optional<String>.none
        )
        return response.sessions
    }

    func submitTurn(
        clientId: String,
        hostId: String,
        sessionId: String,
        message: String,
        createdAt: String
    ) async throws -> RelayTurn {
        struct Payload: Encodable {
            let clientId: String
            let hostId: String
            let sessionId: String
            let message: String
            let createdAt: String
        }

        let response: RelayTurnEnvelopeResponse = try await send(
            path: "/turns",
            method: "POST",
            body: Payload(
                clientId: clientId,
                hostId: hostId,
                sessionId: sessionId,
                message: message,
                createdAt: createdAt
            )
        )
        return response.turn
    }

    func turnStatus(clientId: String, turnId: String) async throws -> RelayTurn {
        let encodedClientId = clientId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? clientId
        let encodedTurnId = turnId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? turnId
        let response: RelayTurnEnvelopeResponse = try await send(
            path: "/clients/\(encodedClientId)/turns/\(encodedTurnId)",
            method: "GET",
            body: Optional<String>.none
        )
        return response.turn
    }

    func waitForTurn(
        clientId: String,
        turnId: String,
        maxAttempts: Int = 45,
        pollIntervalNanoseconds: UInt64 = 1_000_000_000,
        onUpdate: ((RelayTurn) async -> Void)? = nil
    ) async throws -> RelayTurn {
        for attempt in 0 ..< maxAttempts {
            try Task.checkCancellation()

            let turn = try await turnStatus(clientId: clientId, turnId: turnId)
            if let onUpdate {
                await onUpdate(turn)
            }
            if turn.isTerminal {
                return turn
            }

            if attempt < maxAttempts - 1 {
                try await Task.sleep(nanoseconds: pollIntervalNanoseconds)
            }
        }

        throw BridgeClientError.server("Relay 响应超时，请稍后重试。")
    }

    private func send<Response: Decodable, Body: Encodable>(
        path: String,
        method: String,
        body: Body?
    ) async throws -> Response {
        try await sendRelayRequest(
            relayBaseURL: relayBaseURL,
            path: path,
            method: method,
            body: body
        )
    }
}

struct CallClient {
    let relayBaseURL: String

    func createCall(
        callId: String,
        clientId: String,
        hostId: String,
        sessionId: String,
        mode: RelayCallMode,
        createdAt: String,
        mediaConfig: RelayMediaConfig? = nil
    ) async throws -> RelayCallSummary {
        struct Payload: Encodable {
            let callId: String
            let clientId: String
            let hostId: String
            let sessionId: String
            let mode: String
            let state: String
            let createdAt: String
            let updatedAt: String
            let mediaConfig: RelayMediaConfig?
        }

        let response: RelayCallEnvelopeResponse = try await send(
            path: "/calls",
            method: "POST",
            body: Payload(
                callId: callId,
                clientId: clientId,
                hostId: hostId,
                sessionId: sessionId,
                mode: mode.rawValue,
                state: RelayCallState.dialing.rawValue,
                createdAt: createdAt,
                updatedAt: createdAt,
                mediaConfig: mediaConfig
            )
        )
        guard let call = response.call else {
            throw BridgeClientError.invalidResponse
        }
        return call
    }

    func callStatus(clientId: String, callId: String) async throws -> RelayCallSummary? {
        let encodedClientId = clientId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? clientId
        let encodedCallId = callId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? callId
        let response: RelayCallEnvelopeResponse = try await send(
            path: "/clients/\(encodedClientId)/calls/\(encodedCallId)",
            method: "GET",
            body: Optional<String>.none
        )
        return response.call
    }

    func endCall(clientId: String, callId: String, updatedAt: String) async throws -> RelayCallSummary {
        struct Payload: Encodable {
            let updatedAt: String
        }

        let encodedClientId = clientId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? clientId
        let encodedCallId = callId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? callId
        let response: RelayCallEnvelopeResponse = try await send(
            path: "/clients/\(encodedClientId)/calls/\(encodedCallId)/end",
            method: "POST",
            body: Payload(updatedAt: updatedAt)
        )
        guard let call = response.call else {
            throw BridgeClientError.invalidResponse
        }
        return call
    }

    func waitForCall(
        clientId: String,
        callId: String,
        maxAttempts: Int = 45,
        pollIntervalNanoseconds: UInt64 = 1_000_000_000,
        onUpdate: ((RelayCallSummary) async -> Void)? = nil
    ) async throws -> RelayCallSummary? {
        for attempt in 0 ..< maxAttempts {
            try Task.checkCancellation()

            if let call = try await callStatus(clientId: clientId, callId: callId) {
                if let onUpdate {
                    await onUpdate(call)
                }
                if call.state == .live || call.state == .ended || call.state == .failed {
                    return call
                }
            }

            if attempt < maxAttempts - 1 {
                try await Task.sleep(nanoseconds: pollIntervalNanoseconds)
            }
        }

        throw BridgeClientError.server("语音连接超时，请稍后重试。")
    }

    private func send<Response: Decodable, Body: Encodable>(
        path: String,
        method: String,
        body: Body?
    ) async throws -> Response {
        try await sendRelayRequest(
            relayBaseURL: relayBaseURL,
            path: path,
            method: method,
            body: body
        )
    }
}

private func sendRelayRequest<Response: Decodable, Body: Encodable>(
    relayBaseURL: String,
    path: String,
    method: String,
    body: Body?
) async throws -> Response {
    let trimmedBaseURL = relayBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)
    let normalizedBaseURL = trimmedBaseURL.hasSuffix("/api")
        ? String(trimmedBaseURL.dropLast(4))
        : trimmedBaseURL
    guard let url = URL(string: normalizedBaseURL + "/api" + path) else {
        throw BridgeClientError.invalidURL
    }

    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.timeoutInterval = RelayTransportDefaults.requestTimeoutSeconds

    if let body {
        request.httpBody = try JSONEncoder().encode(body)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }

    let data: Data
    let response: URLResponse
    do {
        (data, response) = try await URLSession.shared.data(for: request)
    } catch {
        throw mapTransportError(error, serviceName: "Relay")
    }
    guard let httpResponse = response as? HTTPURLResponse else {
        throw BridgeClientError.invalidResponse
    }

    guard (200 ..< 300).contains(httpResponse.statusCode) else {
        if
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let message = json["error"] as? String
        {
            throw BridgeClientError.server(message)
        }
        throw BridgeClientError.server("请求失败：HTTP \(httpResponse.statusCode)")
    }

    do {
        return try JSONDecoder().decode(Response.self, from: data)
    } catch {
        throw BridgeClientError.invalidResponse
    }
}
