import Foundation

public enum DiscussionContractError: Error, Equatable, Sendable {
  case unsupportedSchemaVersion(Int)
  case invalidVideoID
  case invalidGeneratedRange
  case duplicateEventID(String)
  case unsortedEvents
  case invalidEventBounds(String)
  case invalidConfidence(String)
}

public struct DiscussionAnalysis: Codable, Equatable, Sendable {
  public static let supportedSchemaVersion = 1

  public let schemaVersion: Int
  public let videoId: String
  public let title: String
  public let generatedAt: Date
  public let expiresAt: Date
  public let events: [DiscussionEvent]

  public init(
    schemaVersion: Int = supportedSchemaVersion,
    videoId: String,
    title: String,
    generatedAt: Date,
    expiresAt: Date,
    events: [DiscussionEvent]
  ) {
    self.schemaVersion = schemaVersion
    self.videoId = videoId
    self.title = title
    self.generatedAt = generatedAt
    self.expiresAt = expiresAt
    self.events = events
  }

  public func validate() throws {
    guard schemaVersion == Self.supportedSchemaVersion else {
      throw DiscussionContractError.unsupportedSchemaVersion(schemaVersion)
    }
    guard Self.isValidYouTubeVideoID(videoId) else {
      throw DiscussionContractError.invalidVideoID
    }
    guard generatedAt <= expiresAt else {
      throw DiscussionContractError.invalidGeneratedRange
    }

    var ids = Set<String>()
    var lastTrigger = -Double.infinity
    for event in events {
      guard ids.insert(event.id).inserted else {
        throw DiscussionContractError.duplicateEventID(event.id)
      }
      try event.validate()
      guard event.triggerTime >= lastTrigger else {
        throw DiscussionContractError.unsortedEvents
      }
      lastTrigger = event.triggerTime
    }
  }

  static func isValidYouTubeVideoID(_ value: String) -> Bool {
    guard value.count == 11 else { return false }
    return value.unicodeScalars.allSatisfy {
      CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_"
    }
  }
}

public struct DiscussionEvent: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let startTime: Double
  public let triggerTime: Double
  public let endTime: Double
  public let speaker: String?
  public let type: String
  public let title: String
  public let summary: String
  public let confidence: Double
  public let evidence: String

  public init(
    id: String,
    startTime: Double,
    triggerTime: Double,
    endTime: Double,
    speaker: String? = nil,
    type: String,
    title: String,
    summary: String,
    confidence: Double,
    evidence: String
  ) {
    self.id = id
    self.startTime = startTime
    self.triggerTime = triggerTime
    self.endTime = endTime
    self.speaker = speaker
    self.type = type
    self.title = title
    self.summary = summary
    self.confidence = confidence
    self.evidence = evidence
  }

  public func validate() throws {
    guard !id.isEmpty,
      startTime.isFinite, triggerTime.isFinite, endTime.isFinite,
      startTime >= 0, startTime <= triggerTime, triggerTime <= endTime
    else {
      throw DiscussionContractError.invalidEventBounds(id)
    }
    guard confidence.isFinite, (0...1).contains(confidence) else {
      throw DiscussionContractError.invalidConfidence(id)
    }
  }
}

public struct DiscussionPlaybackState: Codable, Equatable, Sendable {
  public static let supportedSchemaVersion = 1

  public let schemaVersion: Int
  public let videoId: String
  public let currentTime: Double
  public let duration: Double
  public let paused: Bool
  public let playbackRate: Double
  public let observedAt: Date

  public init(
    schemaVersion: Int = supportedSchemaVersion,
    videoId: String,
    currentTime: Double,
    duration: Double,
    paused: Bool,
    playbackRate: Double = 1,
    observedAt: Date
  ) {
    self.schemaVersion = schemaVersion
    self.videoId = videoId
    self.currentTime = currentTime
    self.duration = duration
    self.paused = paused
    self.playbackRate = playbackRate
    self.observedAt = observedAt
  }
}

public enum DiscussionJSON {
  public static func makeDecoder() -> JSONDecoder {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .custom { decoder in
      let container = try decoder.singleValueContainer()
      let value = try container.decode(String.self)
      let fractional = ISO8601DateFormatter()
      fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      let wholeSeconds = ISO8601DateFormatter()
      wholeSeconds.formatOptions = [.withInternetDateTime]
      guard let date = fractional.date(from: value) ?? wholeSeconds.date(from: value) else {
        throw DecodingError.dataCorruptedError(
          in: container,
          debugDescription: "Expected an ISO-8601 timestamp"
        )
      }
      return date
    }
    return decoder
  }

  public static func makeEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.outputFormatting = [.sortedKeys]
    return encoder
  }
}
