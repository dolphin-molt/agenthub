import SwiftUI

struct ConnectionSheet: View {
    @ObservedObject var store: ChatStore
    @Environment(\.dismiss) private var dismiss
    @State private var pairingInput = ""
    @State private var baseURL = ""
    @State private var token = ""
    @State private var isShowingDirectForm = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    PairingHeroCard()

                    if case .failed(let message) = store.connectionState {
                        ConnectionIssueCard(message: message)
                    }

                    PairingEntryCard(
                        pairingInput: $pairingInput,
                        isConnecting: store.connectionState == .connecting,
                        stage: store.connectionStage,
                        onConnect: connectPairing
                    )

                    DirectBridgeCard(
                        baseURL: $baseURL,
                        token: $token,
                        isExpanded: $isShowingDirectForm,
                        onUseDefault: { baseURL = BridgeConfig.default.baseURL },
                        onConnect: connectDirect
                    )

                    ConnectionNotesCard()
                }
                .padding(18)
            }
            .background(sheetBackground.ignoresSafeArea())
            .navigationTitle("Connect Bridge")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") {
                        dismiss()
                    }
                }
            }
            .onAppear {
                pairingInput = ""
                baseURL = store.connectionConfig.directBridge.baseURL
                token = store.connectionConfig.directBridge.token
            }
        }
    }

    private var sheetBackground: LinearGradient {
        ChatChromePresentation.backgroundGradient
    }

    private func connectPairing() {
        Task {
            await store.completePairing(from: pairingInput)
            if case .connected = store.connectionState {
                dismiss()
            }
        }
    }

    private func connectDirect() {
        store.applyDirectConfig(baseURL: baseURL, token: token)
        Task {
            await store.connectDirect()
            if case .connected = store.connectionState {
                dismiss()
            }
        }
    }
}

private struct PairingHeroCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Bring your local agent onto your phone.")
                .font(.system(size: 26, weight: .bold))
                .foregroundStyle(.primary)

            Text("Scan the desktop QR code to open and connect instantly, or paste the pairing link manually. This keeps relay onboarding as the default path, then layers voice, notifications, and remote control on top.")
                .font(.system(size: 15))
                .foregroundStyle(ChatChromePresentation.secondaryTextColor)
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ChatChromePresentation.surfaceColor, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
    }
}

private struct ConnectionIssueCard: View {
    let message: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(.red)
                .frame(width: 38, height: 38)
                .background(Color.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                Text("Connection issue")
                    .font(.system(size: 17, weight: .semibold))
                Text(message)
                    .font(.system(size: 14))
                    .foregroundStyle(ChatChromePresentation.secondaryTextColor)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ChatChromePresentation.surfaceColor, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}

private struct PairingEntryCard: View {
    @Binding var pairingInput: String
    let isConnecting: Bool
    let stage: ConnectionProgressStage?
    let onConnect: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Pair with desktop")
                .font(.system(size: 18, weight: .semibold))

            Text("Scan the QR code from AgentHub desktop, or paste the pairing link here.")
                .font(.system(size: 13))
                .foregroundStyle(ChatChromePresentation.secondaryTextColor)

            TextField("Paste pairing link", text: $pairingInput, axis: .vertical)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .lineLimit(3 ... 6)
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .background(ChatChromePresentation.inputFillColor, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(ChatChromePresentation.inputStrokeColor, lineWidth: 1)
                }

            if isConnecting, let stage {
                Text(stage.detail)
                    .font(.system(size: 12))
                    .foregroundStyle(ChatChromePresentation.secondaryTextColor)
            }

            Button(action: onConnect) {
                HStack {
                    Text(isConnecting ? "Pairing..." : "Pair and connect")
                        .font(.system(size: 16, weight: .semibold))
                    Spacer()
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 14, weight: .semibold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 18)
                .padding(.vertical, 16)
                .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(pairingInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isConnecting)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ChatChromePresentation.surfaceColor, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
    }
}

private struct DirectBridgeCard: View {
    @Binding var baseURL: String
    @Binding var token: String
    @Binding var isExpanded: Bool
    let onUseDefault: () -> Void
    let onConnect: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Advanced")
                        .font(.system(size: 18, weight: .semibold))
                    Text("Keep direct bridge for local debugging while relay text turn is still landing.")
                        .font(.system(size: 14))
                        .foregroundStyle(ChatChromePresentation.secondaryTextColor)
                }

                Spacer()

                Button(isExpanded ? "Hide" : "Show") {
                    withAnimation(.spring(response: 0.28, dampingFraction: 0.9)) {
                        isExpanded.toggle()
                    }
                }
                .buttonStyle(.plain)
                .font(.system(size: 14, weight: .semibold))
            }

            if isExpanded {
                VStack(alignment: .leading, spacing: 12) {
                    TextField("Base URL", text: $baseURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .textContentType(.URL)
                        .keyboardType(.URL)
                        .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .background(ChatChromePresentation.inputFillColor, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .stroke(ChatChromePresentation.inputStrokeColor, lineWidth: 1)
                    }

                    SecureField("Token", text: $token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(.horizontal, 16)
                        .padding(.vertical, 14)
                        .background(ChatChromePresentation.inputFillColor, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .stroke(ChatChromePresentation.inputStrokeColor, lineWidth: 1)
                        }

                    HStack {
                        Button("Use default Cloudflare entry", action: onUseDefault)
                            .buttonStyle(.plain)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(Color.accentColor)

                        Spacer()

                        Button("Connect direct", action: onConnect)
                            .buttonStyle(.plain)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 12)
                            .background(Color.black.opacity(0.84), in: Capsule())
                    }
                }
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ChatChromePresentation.surfaceColor, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
    }
}

private struct ConnectionNotesCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("What this connection is for")
                .font(.system(size: 18, weight: .semibold))

            Text("This app talks to the remote control contract directly. Pairing gets you hosts and sessions first. Voice, approvals, and media will ride on the same connection model later.")
                .font(.system(size: 14))
                .foregroundStyle(ChatChromePresentation.secondaryTextColor)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ChatChromePresentation.surfaceColor, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}
