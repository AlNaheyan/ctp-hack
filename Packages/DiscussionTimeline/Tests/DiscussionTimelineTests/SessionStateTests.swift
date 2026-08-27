import XCTest

@testable import DiscussionTimeline

@MainActor
final class SessionStateTests: XCTestCase {
  func testObservableSessionPublishesCrossedEvent() async throws {
    let session = DiscussionSessionState()
    try session.load(fixtureAnalysis())
    var iterator = session.events.makeAsyncIterator()

    XCTAssertEqual(session.receive(playback(time: 4)), [])
    XCTAssertEqual(session.receive(playback(time: 5)).map(\.id), ["first"])

    let published = await iterator.next()
    XCTAssertEqual(published?.id, "first")
    XCTAssertEqual(session.latestEvents.map(\.id), ["first"])
    XCTAssertEqual(session.playback?.currentTime, 5)
  }
}
