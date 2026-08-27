import DiscussionTimeline
import Foundation

public enum NativeMessagingConstants {
  public static let hostName = "com.ctphack.discussionnotch.bridge"
  public static let playbackNotification = Notification.Name(
    "com.ctphack.discussionnotch.native-playback"
  )
  public static let connectionNotification = Notification.Name(
    "com.ctphack.discussionnotch.native-connection"
  )
  public static let payloadUserInfoKey = "payload"
  public static let stateUserInfoKey = "state"
  public static let maximumMessageBytes = 8 * 1024
}

public enum NativeMessageError: Error, Equatable, Sendable {
  case truncatedHeader
  case truncatedPayload(expected: Int, actual: Int)
  case oversizedPayload(Int)
  case invalidUTF8
  case invalidJSON
  case unsupportedSchemaVersion(Int)
  case unsupportedMessageType(String)
  case invalidPlayback(String)
}

public struct PlaybackMessageEnvelope: Codable, Equatable, Sendable {
  public let schemaVersion: Int
  public let type: String
  public let payload: DiscussionPlaybackState

  public init(schemaVersion: Int, type: String, payload: DiscussionPlaybackState) {
    self.schemaVersion = schemaVersion
    self.type = type
    self.payload = payload
  }

  private enum CodingKeys: String, CodingKey {
    case schemaVersion, type, payload
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    schemaVersion = try container.decode(Int.self, forKey: .schemaVersion)
    type = try container.decode(String.self, forKey: .type)
    let wirePayload = try container.decode(WirePlaybackPayload.self, forKey: .payload)
    payload = wirePayload.playbackState(schemaVersion: schemaVersion)
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(schemaVersion, forKey: .schemaVersion)
    try container.encode(type, forKey: .type)
    try container.encode(WirePlaybackPayload(payload), forKey: .payload)
  }
}

private struct WirePlaybackPayload: Codable {
  let videoId: String
  let currentTime: Double
  let duration: Double
  let paused: Bool
  let playbackRate: Double
  let observedAt: Date

  init(_ state: DiscussionPlaybackState) {
    videoId = state.videoId
    currentTime = state.currentTime
    duration = state.duration
    paused = state.paused
    playbackRate = state.playbackRate
    observedAt = state.observedAt
  }

  func playbackState(schemaVersion: Int) -> DiscussionPlaybackState {
    DiscussionPlaybackState(
      schemaVersion: schemaVersion,
      videoId: videoId,
      currentTime: currentTime,
      duration: duration,
      paused: paused,
      playbackRate: playbackRate,
      observedAt: observedAt
    )
  }
}

public enum NativeMessageCodec {
  public static func frame(_ payload: Data) throws -> Data {
    guard payload.count <= NativeMessagingConstants.maximumMessageBytes else {
      throw NativeMessageError.oversizedPayload(payload.count)
    }
    var length = UInt32(payload.count).littleEndian
    var framed = withUnsafeBytes(of: &length) { Data($0) }
    framed.append(payload)
    return framed
  }

  public static func unframe(_ data: Data) throws -> Data {
    guard data.count >= 4 else { throw NativeMessageError.truncatedHeader }
    let length = data.prefix(4).withUnsafeBytes { rawBuffer in
      Int(rawBuffer.loadUnaligned(as: UInt32.self).littleEndian)
    }
    guard length <= NativeMessagingConstants.maximumMessageBytes else {
      throw NativeMessageError.oversizedPayload(length)
    }
    let actual = data.count - 4
    guard actual == length else {
      throw NativeMessageError.truncatedPayload(expected: length, actual: actual)
    }
    return Data(data.dropFirst(4))
  }

  public static func decodePlayback(_ data: Data) throws -> PlaybackMessageEnvelope {
    guard data.count <= NativeMessagingConstants.maximumMessageBytes else {
      throw NativeMessageError.oversizedPayload(data.count)
    }
    guard String(data: data, encoding: .utf8) != nil else {
      throw NativeMessageError.invalidUTF8
    }

    let envelope: PlaybackMessageEnvelope
    do {
      envelope = try DiscussionJSON.makeDecoder().decode(PlaybackMessageEnvelope.self, from: data)
    } catch {
      throw NativeMessageError.invalidJSON
    }

    guard envelope.schemaVersion == DiscussionPlaybackState.supportedSchemaVersion else {
      throw NativeMessageError.unsupportedSchemaVersion(envelope.schemaVersion)
    }
    guard envelope.type == "PLAYBACK_STATE" else {
      throw NativeMessageError.unsupportedMessageType(envelope.type)
    }
    try validate(envelope.payload)
    return envelope
  }

  public static func encodeReply(_ reply: NativeHostReply) throws -> Data {
    let payload = try DiscussionJSON.makeEncoder().encode(reply)
    return try frame(payload)
  }

  private static func validate(_ playback: DiscussionPlaybackState) throws {
    guard playback.videoId.count == 11,
      playback.videoId.unicodeScalars.allSatisfy({
        CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_"
      })
    else {
      throw NativeMessageError.invalidPlayback("videoId")
    }
    guard playback.currentTime.isFinite, playback.currentTime >= 0,
      playback.duration.isFinite, playback.duration >= 0,
      playback.duration == 0 || playback.currentTime <= playback.duration
    else {
      throw NativeMessageError.invalidPlayback("time")
    }
    guard playback.playbackRate.isFinite, playback.playbackRate > 0 else {
      throw NativeMessageError.invalidPlayback("playbackRate")
    }
  }
}

public struct NativeHostReply: Codable, Equatable, Sendable {
  public let schemaVersion: Int
  public let type: String
  public let ok: Bool
  public let code: String?

  public init(ok: Bool, code: String? = nil) {
    schemaVersion = 1
    type = ok ? "ACK" : "NACK"
    self.ok = ok
    self.code = code
  }
}
