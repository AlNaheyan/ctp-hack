import Foundation

/// Pure value-type matcher. Playback advances only when `consume` receives an update.
public struct DiscussionTimelineEngine: Sendable {
  public static let seekThreshold: TimeInterval = 2

  public private(set) var analysis: DiscussionAnalysis?
  public private(set) var playback: DiscussionPlaybackState?

  private var emittedEventIDs = Set<String>()
  private var nextEventIndex = 0

  public init() {
    analysis = nil
  }

  public init(analysis: DiscussionAnalysis) throws {
    try analysis.validate()
    self.analysis = analysis
  }

  public mutating func load(_ analysis: DiscussionAnalysis) throws {
    try analysis.validate()
    self.analysis = analysis
    playback = nil
    emittedEventIDs.removeAll(keepingCapacity: true)
    nextEventIndex = 0
  }

  public mutating func clear() {
    analysis = nil
    playback = nil
    emittedEventIDs.removeAll(keepingCapacity: false)
    nextEventIndex = 0
  }

  /// Returns every event naturally crossed by this externally observed update.
  public mutating func consume(_ update: DiscussionPlaybackState) -> [DiscussionEvent] {
    guard let analysis, update.videoId == analysis.videoId else {
      if playback?.videoId != update.videoId {
        emittedEventIDs.removeAll(keepingCapacity: true)
      }
      playback = update
      nextEventIndex = 0
      return []
    }

    guard update.currentTime.isFinite, update.currentTime >= 0,
      update.duration.isFinite, update.duration >= 0
    else {
      return []
    }

    guard let previous = playback, previous.videoId == update.videoId else {
      playback = update
      nextEventIndex = insertionIndex(after: update.currentTime, in: analysis.events)
      return []
    }

    playback = update
    let delta = update.currentTime - previous.currentTime

    guard delta != 0 else { return [] }

    if abs(delta) > Self.seekThreshold {
      if delta < 0 {
        rearmEvents(atOrAfter: update.currentTime, events: analysis.events)
      }
      nextEventIndex = insertionIndex(after: update.currentTime, in: analysis.events)
      return []
    }

    // Small backwards movement is playback jitter, not an intentional rewind.
    guard delta > 0 else { return [] }

    var crossed: [DiscussionEvent] = []
    while nextEventIndex < analysis.events.count {
      let event = analysis.events[nextEventIndex]
      guard event.triggerTime <= update.currentTime else { break }
      nextEventIndex += 1
      guard previous.currentTime < event.triggerTime,
        emittedEventIDs.insert(event.id).inserted
      else { continue }
      crossed.append(event)
    }
    return crossed
  }

  private mutating func rearmEvents(atOrAfter time: TimeInterval, events: [DiscussionEvent]) {
    for event in events where event.triggerTime >= time {
      emittedEventIDs.remove(event.id)
    }
  }

  /// Index of the first event strictly after `time`.
  private func insertionIndex(after time: TimeInterval, in events: [DiscussionEvent]) -> Int {
    var lower = 0
    var upper = events.count
    while lower < upper {
      let middle = lower + (upper - lower) / 2
      if events[middle].triggerTime <= time {
        lower = middle + 1
      } else {
        upper = middle
      }
    }
    return lower
  }
}
