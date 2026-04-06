import Foundation

@MainActor
final class CompanionAppModel: ObservableObject {
    enum Status: String, CaseIterable, Identifiable {
        case idle
        case working
        case needsYou = "needs_you"
        case done

        var id: String { rawValue }

        var title: String {
            switch self {
            case .idle:
                return "在旁边陪着你"
            case .working:
                return "我还在推进中"
            case .needsYou:
                return "这一步需要你确认"
            case .done:
                return "这轮先做完了"
            }
        }

        var subtitle: String {
            switch self {
            case .idle:
                return "你可以直接打字、说话、拖文件给我，然后我去接着做。"
            case .working:
                return "默认缩在桌面边上，有结果或卡住再冒出来。"
            case .needsYou:
                return "我会把问题和待确认项收成一小张 review 卡。"
            case .done:
                return "你只需要快速 review，一般不用重新打开大控制台。"
            }
        }

        var accentName: String {
            switch self {
            case .idle:
                return "sky"
            case .working:
                return "amber"
            case .needsYou:
                return "rose"
            case .done:
                return "mint"
            }
        }
    }

    @Published var isExpanded = false
    @Published var status: Status = .idle
    @Published var threadTitle = "新 Companion 主线"
    @Published var currentFocus = "先把原生 macOS 前台壳做出来，再把现有后台控制台接上。"
    @Published var recentActivity = "当前是原生 Companion 骨架，后台 bridge 还没有接。"
    @Published var pendingQuestion = "Companion 默认应该是固定停靠，还是允许像桌宠一样轻度移动？"
    @Published var quickDraft = ""
    @Published var activeTaskCount = 1
    @Published var blockedTaskCount = 1
    @Published var doneTaskCount = 0
    @Published var bridgeState: CompanionBridgeClient.ConnectionState = .disconnected
    @Published var lastDispatchNote = "还没有把消息真正送到后台。"

    let bridgeClient = CompanionBridgeClient()

    func toggleExpanded() {
        isExpanded.toggle()
    }

    func collapse() {
        isExpanded = false
    }

    func expand() {
        isExpanded = true
    }

    func cycleStatus() {
        let all = Status.allCases
        guard let index = all.firstIndex(of: status) else { return }
        status = all[(index + 1) % all.count]
    }

    func submitQuickDraft() async {
        let message = quickDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { return }

        status = .working
        currentFocus = message
        recentActivity = "已从 Companion 发送一条新的 quick chat。"
        activeTaskCount = max(1, activeTaskCount)
        quickDraft = ""

        do {
            try await bridgeClient.enqueueQuickChat(message)
            bridgeState = .connected
            lastDispatchNote = "已发给本地后台。后面要把线程、Agent、审批和 memory 一起带上。"
        } catch {
            bridgeState = .error
            lastDispatchNote = "现在还是本地 stub：界面已更新，但 backend bridge 还没接。"
        }
    }
}
