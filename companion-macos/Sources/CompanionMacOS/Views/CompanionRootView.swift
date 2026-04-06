import SwiftUI

struct CompanionRootView: View {
    @ObservedObject var model: CompanionAppModel

    var body: some View {
        ZStack {
            LinearGradient(
                colors: backgroundColors,
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            if model.isExpanded {
                expandedView
            } else {
                compactView
            }
        }
        .preferredColorScheme(.dark)
    }

    private var backgroundColors: [Color] {
        switch model.status {
        case .idle:
            return [Color(red: 0.08, green: 0.12, blue: 0.2), Color(red: 0.12, green: 0.18, blue: 0.28)]
        case .working:
            return [Color(red: 0.16, green: 0.11, blue: 0.04), Color(red: 0.22, green: 0.14, blue: 0.05)]
        case .needsYou:
            return [Color(red: 0.2, green: 0.07, blue: 0.08), Color(red: 0.27, green: 0.12, blue: 0.07)]
        case .done:
            return [Color(red: 0.05, green: 0.16, blue: 0.12), Color(red: 0.07, green: 0.22, blue: 0.18)]
        }
    }

    private var compactView: some View {
        Button {
            model.expand()
        } label: {
            HStack(spacing: 14) {
                CatBadge(status: model.status)

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        StatusCapsule(status: model.status)
                        Text("⌘ .")
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(.secondary)
                    }

                    Text(model.threadTitle)
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white)
                        .lineLimit(1)

                    Text(model.currentFocus)
                        .font(.system(size: 12, weight: .regular, design: .rounded))
                        .foregroundStyle(.white.opacity(0.72))
                        .lineLimit(2)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(companionCardBackground)
        }
        .buttonStyle(.plain)
        .padding(10)
    }

    private var expandedView: some View {
        VStack(spacing: 14) {
            header
            hero
            metrics
            reviewCard
            quickChatCard
            footerActions
        }
        .padding(18)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var header: some View {
        HStack {
            Text("Companion")
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .tracking(2)
                .foregroundStyle(.white.opacity(0.62))

            Spacer()

            Button("状态轮换") {
                model.cycleStatus()
            }
            .buttonStyle(.borderless)
            .foregroundStyle(.white.opacity(0.72))

            Button {
                model.collapse()
            } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white.opacity(0.72))
            }
            .buttonStyle(.plain)
        }
    }

    private var hero: some View {
        HStack(alignment: .top, spacing: 16) {
            CatBadge(status: model.status)
                .scaleEffect(1.2)

            VStack(alignment: .leading, spacing: 8) {
                StatusCapsule(status: model.status)
                Text(model.status.title)
                    .font(.system(size: 26, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                Text(model.status.subtitle)
                    .font(.system(size: 14, weight: .regular, design: .rounded))
                    .foregroundStyle(.white.opacity(0.74))
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .padding(18)
        .background(companionCardBackground)
    }

    private var metrics: some View {
        HStack(spacing: 10) {
            MetricTile(label: "处理中", value: "\(model.activeTaskCount)")
            MetricTile(label: "待确认", value: "\(model.blockedTaskCount)")
            MetricTile(label: "已完成", value: "\(model.doneTaskCount)")
        }
    }

    private var reviewCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("当前线程")
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .tracking(1.4)
                .foregroundStyle(.white.opacity(0.6))

            Text(model.threadTitle)
                .font(.system(size: 18, weight: .semibold, design: .rounded))
                .foregroundStyle(.white)

            Text(model.currentFocus)
                .font(.system(size: 14, weight: .regular, design: .rounded))
                .foregroundStyle(.white.opacity(0.74))

            Divider()
                .overlay(.white.opacity(0.1))

            VStack(alignment: .leading, spacing: 6) {
                Text("最近动态")
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .tracking(1.4)
                    .foregroundStyle(.white.opacity(0.6))
                Text(model.recentActivity)
                    .font(.system(size: 13, weight: .regular, design: .rounded))
                    .foregroundStyle(.white.opacity(0.78))
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("待确认")
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .tracking(1.4)
                    .foregroundStyle(.white.opacity(0.6))
                Text(model.pendingQuestion)
                    .font(.system(size: 13, weight: .regular, design: .rounded))
                    .foregroundStyle(.white.opacity(0.9))
            }
        }
        .padding(18)
        .background(companionCardBackground)
    }

    private var quickChatCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Quick Chat")
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .tracking(1.4)
                .foregroundStyle(.white.opacity(0.6))

            TextEditor(text: $model.quickDraft)
                .font(.system(size: 14, weight: .regular, design: .rounded))
                .scrollContentBackground(.hidden)
                .foregroundStyle(.white)
                .frame(minHeight: 120)
                .padding(10)
                .background(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(.white.opacity(0.06))
                        .overlay(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .stroke(.white.opacity(0.08), lineWidth: 1)
                        )
                )

            HStack {
                Text(model.lastDispatchNote)
                    .font(.system(size: 12, weight: .regular, design: .rounded))
                    .foregroundStyle(.white.opacity(0.62))
                    .fixedSize(horizontal: false, vertical: true)

                Spacer()

                Button {
                    Task {
                        await model.submitQuickDraft()
                    }
                } label: {
                    Text("发给后台")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(
                            Capsule(style: .continuous)
                                .fill(.white)
                        )
                        .foregroundStyle(.black)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(18)
        .background(companionCardBackground)
    }

    private var footerActions: some View {
        HStack {
            ConnectionPill(state: model.bridgeState)
            Spacer()
            Text("后台 bridge、memory、审批流都还没接。")
                .font(.system(size: 12, weight: .regular, design: .rounded))
                .foregroundStyle(.white.opacity(0.58))
        }
    }

    private var companionCardBackground: some View {
        RoundedRectangle(cornerRadius: 30, style: .continuous)
            .fill(.ultraThinMaterial.opacity(0.85))
            .overlay(
                RoundedRectangle(cornerRadius: 30, style: .continuous)
                    .stroke(.white.opacity(0.1), lineWidth: 1)
            )
    }
}

private struct MetricTile: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .tracking(1.2)
                .foregroundStyle(.white.opacity(0.6))
            Text(value)
                .font(.system(size: 20, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(.white.opacity(0.06))
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .stroke(.white.opacity(0.08), lineWidth: 1)
                )
        )
    }
}

private struct StatusCapsule: View {
    let status: CompanionAppModel.Status

    var body: some View {
        Text(capsuleText)
            .font(.system(size: 11, weight: .semibold, design: .rounded))
            .foregroundStyle(capsuleForeground)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                Capsule(style: .continuous)
                    .fill(capsuleBackground)
            )
    }

    private var capsuleText: String {
        switch status {
        case .idle:
            return "在这儿"
        case .working:
            return "专注中"
        case .needsYou:
            return "等你拍板"
        case .done:
            return "做完了"
        }
    }

    private var capsuleBackground: Color {
        switch status {
        case .idle:
            return .cyan.opacity(0.18)
        case .working:
            return .orange.opacity(0.18)
        case .needsYou:
            return .pink.opacity(0.18)
        case .done:
            return .mint.opacity(0.18)
        }
    }

    private var capsuleForeground: Color {
        switch status {
        case .idle:
            return .cyan
        case .working:
            return .orange
        case .needsYou:
            return .pink
        case .done:
            return .mint
        }
    }
}

private struct ConnectionPill: View {
    let state: CompanionBridgeClient.ConnectionState

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(indicatorColor)
                .frame(width: 8, height: 8)
            Text(label)
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.72))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            Capsule(style: .continuous)
                .fill(.white.opacity(0.06))
                .overlay(
                    Capsule(style: .continuous)
                        .stroke(.white.opacity(0.08), lineWidth: 1)
                )
        )
    }

    private var label: String {
        switch state {
        case .disconnected:
            return "Bridge 未连接"
        case .connecting:
            return "Bridge 连接中"
        case .connected:
            return "Bridge 已连接"
        case .error:
            return "Bridge 异常"
        }
    }

    private var indicatorColor: Color {
        switch state {
        case .disconnected:
            return .gray
        case .connecting:
            return .orange
        case .connected:
            return .green
        case .error:
            return .red
        }
    }
}

private struct CatBadge: View {
    let status: CompanionAppModel.Status

    var body: some View {
        ZStack {
            Circle()
                .fill(
                    LinearGradient(
                        colors: gradientColors,
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(width: 58, height: 58)

            Circle()
                .fill(.white.opacity(0.88))
                .frame(width: 48, height: 48)

            VStack(spacing: 2) {
                HStack(spacing: 10) {
                    Circle().fill(.black.opacity(0.7)).frame(width: 4, height: 4)
                    Circle().fill(.black.opacity(0.7)).frame(width: 4, height: 4)
                }
                Circle()
                    .fill(.pink.opacity(0.85))
                    .frame(width: 5, height: 5)
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(.black.opacity(0.3), lineWidth: 1)
                    .frame(width: 14, height: 8)
            }
        }
        .overlay(alignment: .topLeading) {
            Triangle()
                .fill(.white.opacity(0.88))
                .frame(width: 18, height: 16)
                .rotationEffect(.degrees(-18))
                .offset(x: 8, y: -8)
            Triangle()
                .fill(.white.opacity(0.88))
                .frame(width: 18, height: 16)
                .rotationEffect(.degrees(18))
                .offset(x: 32, y: -8)
        }
        .shadow(color: indicatorShadow, radius: 18, y: 8)
    }

    private var gradientColors: [Color] {
        switch status {
        case .idle:
            return [.cyan.opacity(0.88), .blue.opacity(0.85)]
        case .working:
            return [.orange.opacity(0.88), .yellow.opacity(0.82)]
        case .needsYou:
            return [.pink.opacity(0.86), .red.opacity(0.82)]
        case .done:
            return [.mint.opacity(0.88), .green.opacity(0.78)]
        }
    }

    private var indicatorShadow: Color {
        switch status {
        case .idle:
            return .cyan.opacity(0.34)
        case .working:
            return .orange.opacity(0.3)
        case .needsYou:
            return .pink.opacity(0.34)
        case .done:
            return .mint.opacity(0.3)
        }
    }
}

private struct Triangle: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.midX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}
