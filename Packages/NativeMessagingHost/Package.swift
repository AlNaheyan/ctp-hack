// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "NativeMessagingHost",
  platforms: [.macOS(.v14)],
  products: [
    .library(name: "NativeMessagingBridge", targets: ["NativeMessagingBridge"]),
    .executable(name: "boring-notch-native-host", targets: ["BoringNotchNativeHost"])
  ],
  dependencies: [
    .package(path: "../DiscussionTimeline")
  ],
  targets: [
    .target(
      name: "NativeMessagingBridge",
      dependencies: ["DiscussionTimeline"]
    ),
    .executableTarget(
      name: "BoringNotchNativeHost",
      dependencies: ["NativeMessagingBridge"]
    ),
    .testTarget(
      name: "NativeMessagingBridgeTests",
      dependencies: ["NativeMessagingBridge"]
    )
  ]
)
