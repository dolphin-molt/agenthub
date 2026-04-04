import Foundation

enum BridgeClientError: LocalizedError {
    case invalidURL
    case invalidResponse
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Bridge 地址无效。"
        case .invalidResponse:
            return "Bridge 返回了无效响应。"
        case .server(let message):
            return message
        }
    }
}

func shouldRetryTransportError(_ error: Error) -> Bool {
    guard let urlError = error as? URLError else {
        return false
    }

    switch urlError.code {
    case .timedOut, .networkConnectionLost, .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed:
        return true
    default:
        return false
    }
}

func mapTransportError(_ error: Error, serviceName: String) -> BridgeClientError {
    if let clientError = error as? BridgeClientError {
        return clientError
    }

    guard let urlError = error as? URLError else {
        return .server("\(serviceName) 连接失败，请稍后重试。")
    }

    switch urlError.code {
    case .timedOut:
        return .server("\(serviceName) 请求超时，请确认桌面端在线后重试。")
    case .notConnectedToInternet, .networkConnectionLost:
        return .server("当前网络不可用，请检查手机网络后重试。")
    case .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed:
        return .server("\(serviceName) 地址无法连接，请检查入口地址。")
    default:
        return .server("\(serviceName) 连接失败，请稍后重试。")
    }
}

func performTransportRequest(_ request: URLRequest, serviceName: String) async throws -> (Data, URLResponse) {
    var lastError: Error?

    for attempt in 0 ..< RelayTransportDefaults.maxRetryCount {
        do {
            return try await URLSession.shared.data(for: request)
        } catch {
            lastError = error
            let isLastAttempt = attempt == RelayTransportDefaults.maxRetryCount - 1
            guard shouldRetryTransportError(error), !isLastAttempt else {
                throw mapTransportError(error, serviceName: serviceName)
            }

            let delay = RelayTransportDefaults.retryBackoffNanoseconds * UInt64(attempt + 1)
            try? await Task.sleep(nanoseconds: delay)
        }
    }

    throw mapTransportError(lastError ?? URLError(.unknown), serviceName: serviceName)
}

struct BridgeClient {
    var config: BridgeConfig

    func health() async throws -> BridgeHealth {
        try await send(path: "/health", method: "GET", body: Optional<String>.none)
    }

    func listThreads() async throws -> [ThreadSummary] {
        let response: ThreadsResponse = try await send(path: "/threads", method: "GET", body: Optional<String>.none)
        return response.threads
    }

    func threadDetail(id: String) async throws -> ThreadEnvelope {
        try await send(path: "/threads/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)", method: "GET", body: Optional<String>.none)
    }

    func sendTurn(threadId: String?, message: String) async throws -> TurnResponse {
        struct Payload: Encodable {
            let threadId: String?
            let message: String
        }

        return try await send(
            path: "/turn",
            method: "POST",
            body: Payload(threadId: threadId, message: message)
        )
    }

    private func send<Response: Decodable, Body: Encodable>(
        path: String,
        method: String,
        body: Body?
    ) async throws -> Response {
        guard let url = URL(string: config.baseURL + path) else {
            throw BridgeClientError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = RelayTransportDefaults.requestTimeoutSeconds

        if let body {
            request.httpBody = try JSONEncoder().encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await performTransportRequest(request, serviceName: "Bridge")
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
}
