import Foundation
import Observation

@MainActor
@Observable
public final class DiscussionSessionState {
  public private(set) var analysis: DiscussionAnalysis?
  public private(set) var playback: DiscussionPlaybackState?
  public private(set) var latestEvents: [DiscussionEvent] = []

  @ObservationIgnored
  public let events: AsyncStream<DiscussionEvent>

  @ObservationIgnored
  private let eventContinuation: AsyncStream<DiscussionEvent>.Continuation

  @ObservationIgnored
  private var engine: DiscussionTimelineEngine

  public init() {
    let stream = AsyncStream<DiscussionEvent>.makeStream()
    events = stream.stream
    eventContinuation = stream.continuation
    engine = DiscussionTimelineEngine()
  }

  public func load(_ analysis: DiscussionAnalysis) throws {
    try engine.load(analysis)
    self.analysis = analysis
    playback = nil
    latestEvents = []
  }

  public func clear() {
    engine.clear()
    analysis = nil
    playback = nil
    latestEvents = []
  }

  @discardableResult
  public func receive(_ update: DiscussionPlaybackState) -> [DiscussionEvent] {
    let emitted = engine.consume(update)
    playback = engine.playback
    latestEvents = emitted
    for event in emitted {
      eventContinuation.yield(event)
    }
    return emitted
  }
}
