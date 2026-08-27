import Foundation

public protocol DiscussionClock: Sendable {
  func now() -> Date
}

public struct SystemDiscussionClock: DiscussionClock {
  public init() {}
  public func now() -> Date { Date() }
}

public protocol DiscussionCacheStorage: Sendable {
  func read(key: String) async throws -> Data?
  func write(_ data: Data, key: String) async throws
  func remove(key: String) async throws
  func keys() async throws -> [String]
}

public actor FileDiscussionCacheStorage: DiscussionCacheStorage {
  public static func defaultDirectory(
    fileManager: FileManager = .default
  ) throws -> URL {
    let root = try fileManager.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )
    return
      root
      .appendingPathComponent("com.ctphack.discussionnotch", isDirectory: true)
      .appendingPathComponent("DiscussionTimeline", isDirectory: true)
      .appendingPathComponent("v1", isDirectory: true)
  }

  private let directory: URL
  private let fileManager: FileManager

  public init(directory: URL, fileManager: FileManager = .default) throws {
    self.directory = directory
    self.fileManager = fileManager
    try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
  }

  public func read(key: String) async throws -> Data? {
    let url = fileURL(for: key)
    guard fileManager.fileExists(atPath: url.path) else { return nil }
    return try Data(contentsOf: url)
  }

  public func write(_ data: Data, key: String) async throws {
    try data.write(to: fileURL(for: key), options: [.atomic])
  }

  public func remove(key: String) async throws {
    let url = fileURL(for: key)
    if fileManager.fileExists(atPath: url.path) {
      try fileManager.removeItem(at: url)
    }
  }

  public func keys() async throws -> [String] {
    try fileManager.contentsOfDirectory(
      at: directory,
      includingPropertiesForKeys: nil
    )
    .filter { $0.pathExtension == "json" }
    .map { $0.deletingPathExtension().lastPathComponent }
  }

  private func fileURL(for key: String) -> URL {
    directory.appendingPathComponent(key).appendingPathExtension("json")
  }
}

public actor DiscussionTimelineCache {
  public static let timeToLive: TimeInterval = 24 * 60 * 60

  private struct Entry: Codable, Sendable {
    let cacheSchemaVersion: Int
    let storedAt: Date
    let analysis: DiscussionAnalysis
  }

  private let storage: any DiscussionCacheStorage
  private let clock: any DiscussionClock
  private let decoder: JSONDecoder
  private let encoder: JSONEncoder

  public init(
    storage: any DiscussionCacheStorage,
    clock: any DiscussionClock = SystemDiscussionClock()
  ) {
    self.storage = storage
    self.clock = clock
    decoder = DiscussionJSON.makeDecoder()
    encoder = DiscussionJSON.makeEncoder()
  }

  public func value(for videoId: String) async -> DiscussionAnalysis? {
    guard DiscussionAnalysis.isValidYouTubeVideoID(videoId) else { return nil }
    let key = videoId
    do {
      guard let data = try await storage.read(key: key) else { return nil }
      let entry = try decoder.decode(Entry.self, from: data)
      try entry.analysis.validate()
      let now = clock.now()
      guard entry.cacheSchemaVersion == 1,
        now < entry.analysis.expiresAt,
        now.timeIntervalSince(entry.storedAt) < Self.timeToLive
      else {
        try await storage.remove(key: key)
        return nil
      }
      return entry.analysis
    } catch {
      try? await storage.remove(key: key)
      return nil
    }
  }

  public func store(_ analysis: DiscussionAnalysis) async throws {
    try analysis.validate()
    let entry = Entry(cacheSchemaVersion: 1, storedAt: clock.now(), analysis: analysis)
    try await storage.write(encoder.encode(entry), key: analysis.videoId)
  }

  public func remove(videoId: String) async throws {
    guard DiscussionAnalysis.isValidYouTubeVideoID(videoId) else { return }
    try await storage.remove(key: videoId)
  }

  /// Eagerly reads every entry so invalid, corrupt, and expired files are evicted.
  public func evictInvalidEntries() async {
    guard let keys = try? await storage.keys() else { return }
    for key in keys {
      if DiscussionAnalysis.isValidYouTubeVideoID(key) {
        _ = await value(for: key)
      } else {
        try? await storage.remove(key: key)
      }
    }
  }
}
