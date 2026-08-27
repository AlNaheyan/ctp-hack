import Foundation
import XCTest

@testable import DiscussionTimeline

final class TimelineCacheTests: XCTestCase {
  func testCacheMissAndHit() async throws {
    let storage = MemoryStorage()
    let cache = DiscussionTimelineCache(storage: storage, clock: FixedClock(referenceDate))

    let miss = await cache.value(for: videoA)
    XCTAssertNil(miss)
    try await cache.store(fixtureAnalysis())
    let hit = await cache.value(for: videoA)
    XCTAssertEqual(hit, fixtureAnalysis())
  }

  func testRefreshReplacesExistingValue() async throws {
    let storage = MemoryStorage()
    let cache = DiscussionTimelineCache(storage: storage, clock: FixedClock(referenceDate))
    try await cache.store(fixtureAnalysis())
    let refreshed = DiscussionAnalysis(
      videoId: videoA,
      title: "Refreshed",
      generatedAt: referenceDate.addingTimeInterval(60),
      expiresAt: referenceDate.addingTimeInterval(86_400),
      events: [event(id: "replacement", trigger: 12)]
    )

    try await cache.store(refreshed)

    let result = await cache.value(for: videoA)
    XCTAssertEqual(result, refreshed)
  }

  func testAnalysisExpiryEvictsEntry() async throws {
    let storage = MemoryStorage()
    let clock = MutableClock(referenceDate)
    let cache = DiscussionTimelineCache(storage: storage, clock: clock)
    try await cache.store(fixtureAnalysis(expiresAt: referenceDate.addingTimeInterval(10)))

    clock.date = referenceDate.addingTimeInterval(11)

    let result = await cache.value(for: videoA)
    let stored = try await storage.read(key: videoA)
    XCTAssertNil(result)
    XCTAssertNil(stored)
  }

  func testTwentyFourHourTTLExpiryEvictsEntry() async throws {
    let storage = MemoryStorage()
    let clock = MutableClock(referenceDate)
    let cache = DiscussionTimelineCache(storage: storage, clock: clock)
    let longLived = fixtureAnalysis(expiresAt: referenceDate.addingTimeInterval(7 * 86_400))
    try await cache.store(longLived)

    clock.date = referenceDate.addingTimeInterval(86_400)

    let result = await cache.value(for: videoA)
    XCTAssertNil(result)
  }

  func testCorruptEntryIsMissAndIsEvicted() async throws {
    let storage = MemoryStorage()
    try await storage.write(Data("not json".utf8), key: videoA)
    let cache = DiscussionTimelineCache(storage: storage, clock: FixedClock(referenceDate))

    let result = await cache.value(for: videoA)
    let stored = try await storage.read(key: videoA)
    XCTAssertNil(result)
    XCTAssertNil(stored)
  }

  func testInvalidVideoIDCannotAddressStorage() async throws {
    let storage = MemoryStorage()
    try await storage.write(Data("outside".utf8), key: "../outside")
    let cache = DiscussionTimelineCache(storage: storage, clock: FixedClock(referenceDate))

    let result = await cache.value(for: "../outside")

    XCTAssertNil(result)
    let beforeEviction = try await storage.read(key: "../outside")
    XCTAssertNotNil(beforeEviction)
    await cache.evictInvalidEntries()
    let afterEviction = try await storage.read(key: "../outside")
    XCTAssertNil(afterEviction)
  }

  func testIncompatibleAnalysisIsMissAndIsEvicted() async throws {
    let storage = MemoryStorage()
    let incompatible = """
      {
        "cacheSchemaVersion": 1,
        "storedAt": "2026-08-27T16:00:00Z",
        "analysis": {
          "schemaVersion": 99,
          "videoId": "dQw4w9WgXcQ",
          "title": "Future data",
          "generatedAt": "2026-08-27T16:00:00Z",
          "expiresAt": "2026-08-28T16:00:00Z",
          "events": []
        }
      }
      """
    try await storage.write(Data(incompatible.utf8), key: videoA)
    let cache = DiscussionTimelineCache(storage: storage, clock: FixedClock(referenceDate))

    let result = await cache.value(for: videoA)
    let stored = try await storage.read(key: videoA)
    XCTAssertNil(result)
    XCTAssertNil(stored)
  }
}

actor MemoryStorage: DiscussionCacheStorage {
  private var values: [String: Data] = [:]

  func read(key: String) async throws -> Data? { values[key] }
  func write(_ data: Data, key: String) async throws { values[key] = data }
  func remove(key: String) async throws { values[key] = nil }
  func keys() async throws -> [String] { Array(values.keys) }
}

struct FixedClock: DiscussionClock {
  let date: Date
  init(_ date: Date) { self.date = date }
  func now() -> Date { date }
}

final class MutableClock: DiscussionClock, @unchecked Sendable {
  private let lock = NSLock()
  private var storedDate: Date

  init(_ date: Date) { storedDate = date }

  var date: Date {
    get { lock.withLock { storedDate } }
    set { lock.withLock { storedDate = newValue } }
  }

  func now() -> Date { date }
}
