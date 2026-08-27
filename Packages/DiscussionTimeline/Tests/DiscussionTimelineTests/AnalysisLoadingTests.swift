import Foundation
import XCTest

@testable import DiscussionTimeline

final class AnalysisURLTests: XCTestCase {
  func testAcceptsSupportedYouTubeURLShapes() {
    XCTAssertEqual(
      DiscussionYouTubeURL.parse("https://www.youtube.com/watch?v=dQw4w9WgXcQ")?.videoId,
      videoA
    )
    XCTAssertEqual(DiscussionYouTubeURL.parse("https://youtu.be/dQw4w9WgXcQ?t=4")?.videoId, videoA)
    XCTAssertEqual(DiscussionYouTubeURL.parse("https://youtube.com/shorts/dQw4w9WgXcQ")?.videoId, videoA)
  }

  func testRejectsNonYouTubeAndMalformedURLs() {
    XCTAssertNil(DiscussionYouTubeURL.parse("https://example.com/watch?v=dQw4w9WgXcQ"))
    XCTAssertNil(DiscussionYouTubeURL.parse("https://youtube.com/watch?v=short"))
    XCTAssertNil(DiscussionYouTubeURL.parse("dQw4w9WgXcQ"))
  }
}

@MainActor
final class AnalysisCoordinatorTests: XCTestCase {
  func testCacheHitActivatesWithoutCallingAPI() async throws {
    let storage = MemoryStorage()
    let cache = DiscussionTimelineCache(storage: storage, clock: FixedClock(referenceDate))
    try await cache.store(fixtureAnalysis())
    let api = MockAnalysisAPI(results: [.failure(.offline)])
    let coordinator = DiscussionAnalysisCoordinator(api: api, cache: cache)

    coordinator.submit("https://www.youtube.com/watch?v=\(videoA)")
    await waitUntilReady(coordinator)

    XCTAssertEqual(coordinator.session.analysis, fixtureAnalysis())
    XCTAssertEqual(coordinator.state, .ready(videoId: videoA, eventCount: 3, source: .cache))
    let callCount = await api.callCount
    XCTAssertEqual(callCount, 0)
  }

  func testRefreshBypassesCacheAndReplacesAnalysis() async throws {
    let storage = MemoryStorage()
    let cache = DiscussionTimelineCache(storage: storage, clock: FixedClock(referenceDate))
    try await cache.store(fixtureAnalysis())
    let refreshed = DiscussionAnalysis(
      videoId: videoA,
      title: "Refreshed",
      generatedAt: referenceDate,
      expiresAt: referenceDate.addingTimeInterval(86_400),
      events: [event(id: "network", trigger: 8)]
    )
    let api = MockAnalysisAPI(results: [.success(.analysis(refreshed))])
    let coordinator = DiscussionAnalysisCoordinator(api: api, cache: cache)

    coordinator.submit("https://youtu.be/\(videoA)", forceRefresh: true)
    await waitUntilReady(coordinator)

    XCTAssertEqual(coordinator.session.analysis, refreshed)
    XCTAssertEqual(coordinator.state, .ready(videoId: videoA, eventCount: 1, source: .network))
    let callCount = await api.callCount
    let lastForceRefresh = await api.lastForceRefresh
    XCTAssertEqual(callCount, 1)
    XCTAssertEqual(lastForceRefresh, true)
  }

  func testMismatchedResponseDoesNotActivateOrCache() async throws {
    let other = DiscussionAnalysis(
      videoId: videoB,
      title: "Wrong video",
      generatedAt: referenceDate,
      expiresAt: referenceDate.addingTimeInterval(86_400),
      events: []
    )
    let storage = MemoryStorage()
    let cache = DiscussionTimelineCache(storage: storage, clock: FixedClock(referenceDate))
    let coordinator = DiscussionAnalysisCoordinator(
      api: MockAnalysisAPI(results: [.success(.analysis(other))]),
      cache: cache
    )

    coordinator.submit("https://youtu.be/\(videoA)")
    await waitUntilSettled(coordinator)

    XCTAssertEqual(coordinator.state, .failure(.invalidResponse))
    XCTAssertNil(coordinator.session.analysis)
    let mismatchedCacheValue = await cache.value(for: videoB)
    XCTAssertNil(mismatchedCacheValue)
  }

  func testTypedTranscriptErrorMapsToRecoveryState() async {
    let detail = DiscussionAPIErrorPayload.Detail(
      code: .captionsDisabled,
      message: "Captions are not available for this video.",
      retryable: false
    )
    let coordinator = DiscussionAnalysisCoordinator(
      api: MockAnalysisAPI(results: [.failure(.server(detail))]),
      cache: DiscussionTimelineCache(storage: MemoryStorage(), clock: FixedClock(referenceDate))
    )

    coordinator.submit("https://youtu.be/\(videoA)")
    await waitUntilSettled(coordinator)

    XCTAssertEqual(
      coordinator.state,
      .failure(.noTranscript(message: detail.message, retryable: false))
    )
  }

  func testTransportFailureMapsToOfflineAndCanRetry() async {
    let coordinator = DiscussionAnalysisCoordinator(
      api: MockAnalysisAPI(results: [.failure(.timedOut)]),
      cache: DiscussionTimelineCache(storage: MemoryStorage(), clock: FixedClock(referenceDate))
    )

    coordinator.submit("https://youtu.be/\(videoA)")
    await waitUntilSettled(coordinator)

    XCTAssertEqual(coordinator.state, .failure(.offline))
    if case let .failure(failure) = coordinator.state {
      XCTAssertTrue(failure.retryable)
    }
  }

  func testNewSubmissionSupersedesLateResponse() async throws {
    let api = SuspendedAnalysisAPI()
    let cache = DiscussionTimelineCache(
      storage: MemoryStorage(),
      clock: FixedClock(referenceDate)
    )
    let coordinator = DiscussionAnalysisCoordinator(api: api, cache: cache)

    coordinator.submit("https://youtu.be/\(videoA)", forceRefresh: true)
    await api.waitForCalls(1)
    coordinator.submit("https://youtu.be/\(videoB)", forceRefresh: true)
    await api.waitForCalls(2)
    await api.resume(call: 1, with: analysis(for: videoB))
    await waitUntilReady(coordinator)
    await api.resume(call: 0, with: analysis(for: videoA))
    await Task.yield()

    XCTAssertEqual(coordinator.session.analysis?.videoId, videoB)
    XCTAssertEqual(coordinator.state, .ready(videoId: videoB, eventCount: 2, source: .network))
  }

  private func waitUntilReady(_ coordinator: DiscussionAnalysisCoordinator) async {
    for _ in 0..<100 {
      if case .ready = coordinator.state { return }
      try? await Task.sleep(for: .milliseconds(2))
    }
    XCTFail("Coordinator did not become ready: \(coordinator.state)")
  }

  private func waitUntilSettled(_ coordinator: DiscussionAnalysisCoordinator) async {
    for _ in 0..<100 {
      if case .failure = coordinator.state { return }
      try? await Task.sleep(for: .milliseconds(2))
    }
    XCTFail("Coordinator did not settle: \(coordinator.state)")
  }

  private func analysis(for videoId: String) -> DiscussionAnalysis {
    DiscussionAnalysis(
      videoId: videoId,
      title: "Analysis for \(videoId)",
      generatedAt: referenceDate,
      expiresAt: referenceDate.addingTimeInterval(86_400),
      events: [event(id: "first", trigger: 5), event(id: "second", trigger: 10)]
    )
  }
}

actor MockAnalysisAPI: DiscussionAnalysisAPI {
  private var results: [Result<DiscussionAnalysisAPIResult, DiscussionAnalysisClientError>]
  private(set) var callCount = 0
  private(set) var lastForceRefresh: Bool?

  init(results: [Result<DiscussionAnalysisAPIResult, DiscussionAnalysisClientError>]) {
    self.results = results
  }

  func analyze(url: URL, forceRefresh: Bool) async throws -> DiscussionAnalysisAPIResult {
    callCount += 1
    lastForceRefresh = forceRefresh
    return try results.removeFirst().get()
  }
}

actor SuspendedAnalysisAPI: DiscussionAnalysisAPI {
  private var continuations: [CheckedContinuation<DiscussionAnalysisAPIResult, Error>] = []

  func analyze(url: URL, forceRefresh: Bool) async throws -> DiscussionAnalysisAPIResult {
    try await withCheckedThrowingContinuation { continuation in
      continuations.append(continuation)
    }
  }

  func waitForCalls(_ count: Int) async {
    while continuations.count < count { await Task.yield() }
  }

  func resume(call index: Int, with analysis: DiscussionAnalysis) {
    continuations[index].resume(returning: .analysis(analysis))
  }
}
