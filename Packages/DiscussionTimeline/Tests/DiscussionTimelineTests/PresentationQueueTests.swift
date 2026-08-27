import XCTest

@testable import DiscussionTimeline

final class PresentationQueueTests: XCTestCase {
  func testRapidEventsUseBoundedEarliestAndLatestPolicy() {
    var queue = DiscussionPresentationQueue()
    let events = (1...6).map { event(id: "event-\($0)", trigger: Double($0)) }

    queue.enqueue(events)

    XCTAssertEqual(queue.active?.id, "event-1")
    XCTAssertEqual(queue.waiting.map(\.id), ["event-2", "event-3", "event-6"])
  }

  func testDuplicateVisibleOrQueuedEventsAreIgnored() {
    var queue = DiscussionPresentationQueue()
    let first = event(id: "first", trigger: 1)
    let second = event(id: "second", trigger: 2)

    queue.enqueue([first, second, first, second])

    XCTAssertEqual(queue.active?.id, "first")
    XCTAssertEqual(queue.waiting.map(\.id), ["second"])
  }

  func testDroppedRapidEventRemainsDeduplicated() {
    var queue = DiscussionPresentationQueue()
    let events = (1...6).map { event(id: "event-\($0)", trigger: Double($0)) }
    queue.enqueue(events)

    queue.enqueue([events[3]])

    XCTAssertEqual(queue.waiting.map(\.id), ["event-2", "event-3", "event-6"])
  }

  func testDismissAdvancesFIFOThenBecomesIdle() {
    var queue = DiscussionPresentationQueue()
    queue.enqueue([
      event(id: "first", trigger: 1),
      event(id: "second", trigger: 2),
    ])

    XCTAssertEqual(queue.dismissActive()?.id, "second")
    XCTAssertNil(queue.dismissActive())
    XCTAssertTrue(queue.waiting.isEmpty)
  }
}
