import Foundation
import XCTest

@testable import DiscussionTimeline

final class TimelineEngineTests: XCTestCase {
  func testNaturalCrossingEmitsOnce() throws {
    var engine = try DiscussionTimelineEngine(analysis: fixtureAnalysis())

    XCTAssertEqual(engine.consume(playback(time: 4)), [])
    XCTAssertEqual(engine.consume(playback(time: 5)).map(\.id), ["first"])
    XCTAssertEqual(engine.consume(playback(time: 5)).map(\.id), [])
    XCTAssertEqual(engine.consume(playback(time: 5.5, paused: true)).map(\.id), [])
    XCTAssertEqual(engine.consume(playback(time: 5.5, paused: false)).map(\.id), [])
  }

  func testForwardSeekEmitsNoIntermediateEvents() throws {
    let analysis = DiscussionAnalysis(
      videoId: videoA,
      title: "Long discussion",
      generatedAt: referenceDate,
      expiresAt: referenceDate.addingTimeInterval(86_400),
      events: [event(id: "middle", trigger: 1_000)]
    )
    var engine = try DiscussionTimelineEngine(analysis: analysis)

    XCTAssertEqual(engine.consume(playback(time: 4 * 60)), [])
    XCTAssertEqual(engine.consume(playback(time: 37 * 60)), [])
  }

  func testRewindBeforeTriggerRearmsEvent() throws {
    var engine = try DiscussionTimelineEngine(analysis: fixtureAnalysis())

    _ = engine.consume(playback(time: 4))
    XCTAssertEqual(engine.consume(playback(time: 5)).map(\.id), ["first"])
    XCTAssertEqual(engine.consume(playback(time: 2)).map(\.id), [])
    XCTAssertEqual(engine.consume(playback(time: 4)).map(\.id), [])
    XCTAssertEqual(engine.consume(playback(time: 5)).map(\.id), ["first"])
  }

  func testSmallBackwardJitterDoesNotRearm() throws {
    var engine = try DiscussionTimelineEngine(analysis: fixtureAnalysis())

    _ = engine.consume(playback(time: 4))
    XCTAssertEqual(engine.consume(playback(time: 5)).map(\.id), ["first"])
    XCTAssertEqual(engine.consume(playback(time: 4)).map(\.id), [])
    XCTAssertEqual(engine.consume(playback(time: 5)).map(\.id), [])
  }

  func testRapidEventsAreReturnedInTimelineOrder() throws {
    var engine = try DiscussionTimelineEngine(analysis: fixtureAnalysis())

    _ = engine.consume(playback(time: 4.5))
    XCTAssertEqual(engine.consume(playback(time: 6.2)).map(\.id), ["first", "second"])
  }

  func testVideoChangeClearsPerVideoDedupeAndDoesNotEmitOnAttach() throws {
    var engine = try DiscussionTimelineEngine(analysis: fixtureAnalysis())

    _ = engine.consume(playback(time: 4))
    XCTAssertEqual(engine.consume(playback(time: 5)).map(\.id), ["first"])
    XCTAssertEqual(engine.consume(playback(videoId: videoB, time: 12)), [])
    XCTAssertEqual(engine.consume(playback(time: 4)), [])
    XCTAssertEqual(engine.consume(playback(time: 5)).map(\.id), ["first"])
  }

  func testInvalidAnalysisIsRejected() {
    let invalid = DiscussionAnalysis(
      videoId: videoA,
      title: "Invalid",
      generatedAt: referenceDate,
      expiresAt: referenceDate.addingTimeInterval(86_400),
      events: [event(id: "bad", start: 8, trigger: 5, end: 9)]
    )

    XCTAssertThrowsError(try DiscussionTimelineEngine(analysis: invalid))
  }

  func testPlaybackContractDecodesFractionalObservedAt() throws {
    let json = """
      {
        "schemaVersion": 1,
        "videoId": "dQw4w9WgXcQ",
        "currentTime": 342.91,
        "duration": 1250.4,
        "paused": false,
        "playbackRate": 1.0,
        "observedAt": "2026-08-27T16:03:42.100Z"
      }
      """

    let decoded = try DiscussionJSON.makeDecoder().decode(
      DiscussionPlaybackState.self,
      from: Data(json.utf8)
    )

    XCTAssertEqual(decoded.currentTime, 342.91)
    XCTAssertEqual(decoded.videoId, videoA)
  }
}

let videoA = "dQw4w9WgXcQ"
let videoB = "abcdefghijk"
let referenceDate = Date(timeIntervalSince1970: 1_788_196_800)

func fixtureAnalysis(expiresAt: Date? = nil) -> DiscussionAnalysis {
  DiscussionAnalysis(
    videoId: videoA,
    title: "Example discussion",
    generatedAt: referenceDate,
    expiresAt: expiresAt ?? referenceDate.addingTimeInterval(86_400),
    events: [
      event(id: "first", trigger: 5),
      event(id: "second", start: 5, trigger: 6, end: 7),
      event(id: "late", start: 999, trigger: 1_000, end: 1_001),
    ]
  )
}

func event(
  id: String,
  start: Double? = nil,
  trigger: Double,
  end: Double? = nil
) -> DiscussionEvent {
  DiscussionEvent(
    id: id,
    startTime: start ?? max(0, trigger - 1),
    triggerTime: trigger,
    endTime: end ?? trigger + 1,
    speaker: "Speaker A",
    type: "unsupported_claim",
    title: "Claim needs support",
    summary: "A claim is made without support.",
    confidence: 0.91,
    evidence: "Example evidence"
  )
}

func playback(
  videoId: String = videoA,
  time: Double,
  paused: Bool = false
) -> DiscussionPlaybackState {
  DiscussionPlaybackState(
    videoId: videoId,
    currentTime: time,
    duration: 3_000,
    paused: paused,
    observedAt: referenceDate.addingTimeInterval(time)
  )
}
