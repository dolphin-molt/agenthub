// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "AgentHubCompanionMacOS",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(
            name: "AgentHubCompanionMacOS",
            targets: ["AgentHubCompanionMacOS"]
        )
    ],
    targets: [
        .executableTarget(
            name: "AgentHubCompanionMacOS",
            path: "Sources/AgentHubCompanionMacOS"
        )
    ]
)
