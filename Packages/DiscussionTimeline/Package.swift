// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "DiscussionTimeline",
  platforms: [.macOS(.v14)],
  products: [
    .library(name: "DiscussionTimeline", targets: ["DiscussionTimeline"])
  ],
  targets: [
    .target(name: "DiscussionTimeline"),
    .testTarget(
      name: "DiscussionTimelineTests",
      dependencies: ["DiscussionTimeline"]
    ),
  ]
)
