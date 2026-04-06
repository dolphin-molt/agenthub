import AppKit
import SwiftUI

@MainActor
final class CompanionWindowController: ObservableObject {
    private enum Layout {
        static let compactSize = NSSize(width: 320, height: 118)
        static let expandedSize = NSSize(width: 420, height: 680)
        static let margin: CGFloat = 20
    }

    private weak var window: NSWindow?

    func attach(to window: NSWindow) {
        guard self.window !== window else { return }
        self.window = window

        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.level = .floating
        window.collectionBehavior = [
            .canJoinAllSpaces,
            .fullScreenAuxiliary,
            .stationary,
            .ignoresCycle
        ]
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = true

        window.standardWindowButton(.closeButton)?.isHidden = true
        window.standardWindowButton(.miniaturizeButton)?.isHidden = true
        window.standardWindowButton(.zoomButton)?.isHidden = true
    }

    func applyLayout(expanded: Bool, animated: Bool) {
        guard let window else { return }
        let targetSize = expanded ? Layout.expandedSize : Layout.compactSize

        let update = {
            window.setContentSize(targetSize)
            self.anchorToBottomRight(window)
        }

        if animated {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.18
                context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
                window.animator().setContentSize(targetSize)
                self.anchorToBottomRight(window)
            }
        } else {
            update()
        }
    }

    private func anchorToBottomRight(_ window: NSWindow) {
        let screen = window.screen ?? NSScreen.main
        guard let visibleFrame = screen?.visibleFrame else { return }

        let frame = window.frame
        let origin = NSPoint(
            x: visibleFrame.maxX - frame.width - Layout.margin,
            y: visibleFrame.minY + Layout.margin
        )
        window.setFrameOrigin(origin)
    }
}
