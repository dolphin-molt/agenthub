# Companion Plan

## 产品定义

### Companion 是什么

- 一个常驻在桌面的 macOS 前台 companion
- 用户的主要入口不是控制台，而是 companion
- 用户通过它进行多轮 chat，只是 chat 的载体不再是大窗口
- AgentHub 负责后台能力，不再承载默认前台体验

### Companion 不是什么

- 不是缩小版 AgentHub 配置页
- 不是单纯的灵动岛复制品
- 不是只会聊天的悬浮气泡
- 不是把整个控制台塞进一个透明窗口

## 第一阶段范围

### 已完成

- [x] 独立原生 `companion-macos` 项目骨架
- [x] `SwiftUI + AppKit` 前台窗口壳
- [x] compact / expanded 两种布局
- [x] quick chat 占位交互
- [x] AgentHub bridge client 占位层
- [x] 初版文档和后续清单

### 接下来必须完成

- [ ] 定义本地 bridge 协议
- [ ] 从 Companion 发起 quick chat 到 AgentHub
- [ ] 从 AgentHub 回推 thread summary / pending approval / done 状态
- [ ] Companion 打开主控制台时，能精确跳到对应 thread / review
- [ ] menu bar 常驻和全局快捷键
- [ ] Companion 生命周期和后台保活

## 第二阶段范围

- [ ] review-first 面板
- [ ] approval 卡片
- [ ] 任务状态映射
- [ ] Companion 上的 thread 切换
- [ ] 可配置通知和提示音
- [ ] 简单 memory 回显

## 第三阶段范围

- [ ] 真正的桌宠行为
- [ ] 可替换 companion 外壳
- [ ] 猫咪资产和动作状态机
- [ ] click-through / edge docking / roam
- [ ] 个性化名字、语气、声音

## 模块拆分

### `App`

- App lifecycle
- Scene 管理
- Window 行为
- 全局快捷键

### `Views`

- compact companion
- expanded review sheet
- quick chat
- approval 卡片

### `Services`

- AgentHub bridge client
- event subscription
- local persistence
- notification bridge

### `Domain`

- companion status
- review item
- approval request
- quick chat draft
- memory summary

## 需要 AgentHub 提供的能力

- [ ] 新建或继续一条 thread
- [ ] 把 quick chat 作为 message turn 投递到指定 thread
- [ ] 拉取 thread summary / current focus / task counters
- [ ] 推送 `needs-you`
- [ ] 推送 `done`
- [ ] 打开控制台时带着 `threadId / agentId / draft`
- [ ] 后面再补 memory summary / approvals / video context

## 下一线程建议的起手顺序

1. 先把 `AgentHubBridgeClient` 从 stub 改成真实本地通信层
2. 再把 `CompanionAppModel` 接到真实 thread 状态
3. 然后补 menu bar 和 global shortcut
4. 最后才开始做桌宠动画和个性化外壳
