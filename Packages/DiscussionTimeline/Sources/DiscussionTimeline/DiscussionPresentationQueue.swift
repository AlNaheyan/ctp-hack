/// Bounded FIFO presentation queue used by the notch card layer.
public struct DiscussionPresentationQueue: Equatable, Sendable {
  public static let waitingCapacity = 3

  public private(set) var active: DiscussionEvent?
  public private(set) var waiting: [DiscussionEvent] = []
  private var seenEventIDs: Set<String> = []

  public init() {}

  public mutating func enqueue(_ events: [DiscussionEvent]) {
    for event in events where seenEventIDs.insert(event.id).inserted {
      if active == nil {
        active = event
      } else if waiting.count < Self.waitingCapacity {
        waiting.append(event)
      } else {
        // Preserve the earliest two waiting insights and the latest development.
        waiting[Self.waitingCapacity - 1] = event
      }
    }
  }

  @discardableResult
  public mutating func dismissActive() -> DiscussionEvent? {
    active = waiting.isEmpty ? nil : waiting.removeFirst()
    return active
  }

  public mutating func clear() {
    active = nil
    waiting.removeAll(keepingCapacity: false)
    seenEventIDs.removeAll(keepingCapacity: false)
  }
}
