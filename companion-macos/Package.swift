// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "CompanionMacOS",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(
            name: "CompanionMacOS",
            targets: ["CompanionMacOS"]
        )
    ],
    targets: [
        .executableTarget(
            name: "CompanionMacOS",
            path: "Sources/CompanionMacOS"
        )
    ]
)
