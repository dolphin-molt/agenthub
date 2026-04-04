import Foundation

struct BridgeConfigStore {
    private let key = "lobster-mobile.bridge-config"

    func load() -> MobileConnectionConfig {
        guard
            let data = UserDefaults.standard.data(forKey: key)
        else {
            return .default
        }

        if let config = try? JSONDecoder().decode(MobileConnectionConfig.self, from: data) {
            return config
        }

        if let legacy = try? JSONDecoder().decode(BridgeConfig.self, from: data) {
            return MobileConnectionConfig(
                preferredMode: .direct,
                directBridge: legacy,
                relay: nil
            )
        }

        return .default
    }

    func save(_ config: MobileConnectionConfig) {
        guard let data = try? JSONEncoder().encode(config) else {
            return
        }
        UserDefaults.standard.set(data, forKey: key)
    }
}
