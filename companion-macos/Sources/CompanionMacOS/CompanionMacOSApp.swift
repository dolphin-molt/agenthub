import SwiftUI

@main
struct CompanionMacOSApp: App {
    @StateObject private var model = CompanionAppModel()
    @StateObject private var windowController = CompanionWindowController()

    var body: some Scene {
        WindowGroup("Companion") {
            CompanionRootView(model: model)
                .background(
                    WindowAccessor { window in
                        windowController.attach(to: window)
                        windowController.applyLayout(expanded: model.isExpanded, animated: false)
                    }
                )
                .onChange(of: model.isExpanded) { _, expanded in
                    windowController.applyLayout(expanded: expanded, animated: true)
                }
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize)

        Settings {
            SettingsPlaceholderView()
        }
    }
}

private struct SettingsPlaceholderView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Companion")
                .font(.title2.weight(.semibold))
            Text("这里后面会放 Companion 的个性化设置、通知偏好、桌面行为和后台连接配置。")
                .foregroundStyle(.secondary)
        }
        .padding(24)
        .frame(width: 420)
    }
}
