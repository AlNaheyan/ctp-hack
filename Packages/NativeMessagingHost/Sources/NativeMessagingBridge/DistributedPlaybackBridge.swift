@preconcurrency import Foundation
import DiscussionTimeline
import Observation

public enum NativeConnectionState: String, Codable, Equatable, Sendable {
  case disconnected
  case connecting
  case connected
  case error
}

public protocol PlaybackDelivering: Sendable {
  func deliver(_ payload: Data) throws
  func publishConnection(_ state: NativeConnectionState)
}

public struct DistributedPlaybackDeliverer: PlaybackDelivering {
  public init() {}

  public func deliver(_ payload: Data) throws {
    DistributedNotificationCenter.default().postNotificationName(
      NativeMessagingConstants.playbackNotification,
      object: NativeMessagingConstants.hostName,
      userInfo: [NativeMessagingConstants.payloadUserInfoKey: payload],
      deliverImmediately: true
    )
  }

  public func publishConnection(_ state: NativeConnectionState) {
    DistributedNotificationCenter.default().postNotificationName(
      NativeMessagingConstants.connectionNotification,
      object: NativeMessagingConstants.hostName,
      userInfo: [NativeMessagingConstants.stateUserInfoKey: state.rawValue],
      deliverImmediately: true
    )
  }
}

/// App-facing bridge consumed by W3-T3/W3-T4. It owns the Wave 2 timeline
/// session and publishes native-host connection state without polling.
@MainActor
@Observable
public final class NativePlaybackBridge {
  public static let shared = NativePlaybackBridge()

  public let session: DiscussionSessionState
  public private(set) var connectionState: NativeConnectionState = .disconnected
  public private(set) var lastError: String?
  public private(set) var receivedMessageCount = 0

  @ObservationIgnored
  private var observerTokens: [NSObjectProtocol] = []

  public init(session: DiscussionSessionState = DiscussionSessionState()) {
    self.session = session
  }

  public func start(center: DistributedNotificationCenter = .default()) {
    guard observerTokens.isEmpty else { return }
    connectionState = .connecting

    observerTokens.append(center.addObserver(
      forName: NativeMessagingConstants.playbackNotification,
      object: NativeMessagingConstants.hostName,
      queue: .main
    ) { [weak self] notification in
      Task { @MainActor in self?.receive(notification) }
    })
    observerTokens.append(center.addObserver(
      forName: NativeMessagingConstants.connectionNotification,
      object: NativeMessagingConstants.hostName,
      queue: .main
    ) { [weak self] notification in
      Task { @MainActor in self?.receiveConnection(notification) }
    })
  }

  public func stop(center: DistributedNotificationCenter = .default()) {
    for token in observerTokens { center.removeObserver(token) }
    observerTokens.removeAll()
    connectionState = .disconnected
  }

  private func receive(_ notification: Notification) {
    guard let data = notification.userInfo?[NativeMessagingConstants.payloadUserInfoKey] as? Data else {
      connectionState = .error
      lastError = "Native playback notification did not contain Data."
      return
    }
    do {
      let envelope = try NativeMessageCodec.decodePlayback(data)
      session.receive(envelope.payload)
      receivedMessageCount += 1
      connectionState = .connected
      lastError = nil
    } catch {
      connectionState = .error
      lastError = String(describing: error)
    }
  }

  private func receiveConnection(_ notification: Notification) {
    guard let rawValue = notification.userInfo?[NativeMessagingConstants.stateUserInfoKey] as? String,
      let state = NativeConnectionState(rawValue: rawValue)
    else { return }
    connectionState = state
  }
}
