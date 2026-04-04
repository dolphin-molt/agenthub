import SwiftUI

@main
struct LobsterMobileApp: App {
    @StateObject private var store = ChatStore()

    var body: some Scene {
        WindowGroup {
            RootChatView(store: store)
                .onOpenURL { url in
                    Task {
                        await store.handleIncomingPairingURL(url)
                    }
                }
        }
    }
}
