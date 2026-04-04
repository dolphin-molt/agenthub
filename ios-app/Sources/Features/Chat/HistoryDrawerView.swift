import SwiftUI

struct HistoryDrawerView: View {
    @ObservedObject var store: ChatStore

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            DrawerHeader(title: store.isRelayMode ? "设备与会话" : "历史对话") {
                withAnimation(.spring(response: 0.28, dampingFraction: 0.9)) {
                    store.isShowingHistory = false
                }
            }

            if store.isRelayMode {
                RelayWorkspacePanel(store: store)
            } else {
                DirectThreadPanel(store: store)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 18)
        .padding(.top, 20)
        .padding(.bottom, 12)
        .frame(width: 324)
        .frame(maxHeight: .infinity)
        .background(.ultraThinMaterial)
    }
}

private struct DrawerHeader: View {
    let title: String
    let onClose: () -> Void

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 22, weight: .semibold))
                Text("展开即可切换上下文")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Button("关闭", action: onClose)
                .buttonStyle(.plain)
        }
    }
}

private struct RelayWorkspacePanel: View {
    @ObservedObject var store: ChatStore

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Hosts")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.secondary)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(store.relayHosts) { host in
                        Button {
                            Task {
                                await store.selectRelayHost(host.hostId)
                            }
                        } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(host.displayName)
                                    .font(.system(size: 14, weight: .semibold))
                                    .lineLimit(1)

                                Text(host.status)
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(store.selectedHost?.hostId == host.hostId ? .white.opacity(0.8) : .secondary)
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 12)
                            .frame(width: 168, alignment: .leading)
                            .background(
                                store.selectedHost?.hostId == host.hostId
                                    ? Color.accentColor
                                    : Color.white.opacity(0.72),
                                in: RoundedRectangle(cornerRadius: 20, style: .continuous)
                            )
                            .foregroundStyle(store.selectedHost?.hostId == host.hostId ? .white : .primary)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            if let host = store.selectedHost {
                Text(host.lastSeenAt)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }

            Text("Sessions")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.secondary)
                .padding(.top, 4)

            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(store.relaySessions) { session in
                        Button {
                            store.selectRelaySession(session.sessionId)
                            withAnimation(.spring(response: 0.28, dampingFraction: 0.9)) {
                                store.isShowingHistory = false
                            }
                        } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(alignment: .top) {
                                    Text(session.title)
                                        .font(.system(size: 15, weight: .semibold))
                                        .lineLimit(1)
                                    Spacer()
                                    Text(session.updatedAt)
                                        .font(.system(size: 11, weight: .medium))
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }

                                Text(session.summary.isEmpty ? "No summary yet" : session.summary)
                                    .font(.system(size: 13))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(
                                store.selectedRelaySession?.sessionId == session.sessionId
                                    ? Color.accentColor.opacity(0.12)
                                    : Color.white.opacity(0.72),
                                in: RoundedRectangle(cornerRadius: 18, style: .continuous)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.bottom, 12)
            }
        }
    }
}

private struct DirectThreadPanel: View {
    @ObservedObject var store: ChatStore

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Button {
                store.startNewConversation()
            } label: {
                Label("新对话", systemImage: "square.and.pencil")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
            .buttonStyle(.plain)

            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(store.threads) { thread in
                        Button {
                            Task {
                                try? await store.loadThread(id: thread.id)
                            }
                        } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(alignment: .top) {
                                    Text(thread.title ?? "未命名对话")
                                        .font(.system(size: 15, weight: .semibold))
                                        .foregroundStyle(.primary)
                                        .lineLimit(1)
                                    Spacer()
                                    Text(thread.updatedAt ?? "")
                                        .font(.system(size: 11, weight: .medium))
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }

                                Text(thread.latestMessagePreview ?? thread.goal ?? "还没有消息")
                                    .font(.system(size: 13))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(
                                store.selectedThreadID == thread.id
                                    ? Color.accentColor.opacity(0.12)
                                    : Color.white.opacity(0.72),
                                in: RoundedRectangle(cornerRadius: 18, style: .continuous)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.bottom, 12)
            }
        }
    }
}
