# AgentHub Companion for macOS

这是一个独立于 `AgentHub` 控制台的原生 macOS 前台项目。

目标不是再做一个配置台，而是做一个真正常驻在桌面上的 companion:

- 平时缩成很小的桌面存在
- 需要时展开成 quick chat / review / confirm 面板
- 用户主要通过它交代任务、补充上下文、查看结果
- `AgentHub` 本体降级为后台控制台和能力系统

## 为什么单独建项目

这条前台线和现有 `Tauri + React` 控制台的诉求已经分开了:

- Companion 需要更贴近 macOS 桌面行为
- 透明异形窗口、floating level、workspace 行为、menu bar、全局快捷键，都更适合原生实现
- AgentHub 现有项目继续承载配置、线程、记忆、runtime、tools

一句话:

`Companion 是前台产品，AgentHub 是后台系统。`

## 当前骨架里已经有的东西

- 一个原生 macOS Swift 包项目
- `SwiftUI + AppKit` 混合窗口骨架
- 默认右下角浮动的 compact / expanded 两种布局
- 一个可以直接交互的 quick chat stub
- 一个 `AgentHubBridgeClient` 占位层，后续专门接本地 AgentHub backend

## 当前目录结构

- `Package.swift`
  原生 macOS companion 包定义
- `Sources/AgentHubCompanionMacOS/AgentHubCompanionMacOSApp.swift`
  入口
- `Sources/AgentHubCompanionMacOS/App/CompanionAppModel.swift`
  前台状态模型
- `Sources/AgentHubCompanionMacOS/App/CompanionWindowController.swift`
  窗口行为和停靠
- `Sources/AgentHubCompanionMacOS/Views/CompanionRootView.swift`
  compact / expanded companion UI
- `Sources/AgentHubCompanionMacOS/Services/AgentHubBridgeClient.swift`
  后续接 AgentHub 的通信层占位

## 本机怎么编译

当前这台机器的 active developer directory 是 Command Line Tools，不是完整 Xcode，所以我先按 Swift Package 方式建了骨架。

能直接验证的命令:

```bash
cd companion-macos
swift build
```

如果后面你要用完整原生工作流，建议切到完整 Xcode:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

然后直接用 Xcode 打开这个包，或者在下一线程里把它升级成完整的 `.xcodeproj` / App target。

## 当前明确没做的

- 还没接 AgentHub backend
- 还没做全局快捷键
- 还没做 menu bar/tray
- 还没做 click-through / desktop pet roaming
- 还没做真正的 memory / review / approval 对接
- 还没做 asset / animation 系统

## 下一线程最该做的事

先不要继续加视觉细节，先把这 4 件事打通:

1. 定义 `Companion <-> AgentHub` 本地 bridge 协议
2. 把 quick chat 真的送到 AgentHub 线程系统
3. 把 review / needs-you / done 的事件推送到 Companion
4. 补全 menu bar + global shortcut + app lifecycle
