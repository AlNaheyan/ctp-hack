import Combine
import Foundation

public enum DiscussionAnalysisSource: Equatable, Sendable {
  case cache
  case network
}

public enum DiscussionAnalysisFailure: Equatable, Sendable {
  case invalidURL
  case noTranscript(message: String, retryable: Bool)
  case offline
  case backend(message: String, retryable: Bool)
  case invalidResponse
  case updateRequired

  public var retryable: Bool {
    switch self {
    case .offline, .invalidResponse: true
    case let .noTranscript(_, retryable), let .backend(_, retryable): retryable
    case .invalidURL, .updateRequired: false
    }
  }
}

public enum DiscussionAnalysisLoadingState: Equatable, Sendable {
  case empty
  case submitting(videoId: String)
  case processing(videoId: String)
  case ready(videoId: String, eventCount: Int, source: DiscussionAnalysisSource)
  case failure(DiscussionAnalysisFailure)
}

@MainActor
public final class DiscussionAnalysisCoordinator: ObservableObject {
  @Published public private(set) var state: DiscussionAnalysisLoadingState = .empty
  @Published public private(set) var submittedURL = ""

  public let session: DiscussionSessionState

  private let api: any DiscussionAnalysisAPI
  private let cache: DiscussionTimelineCache
  private var requestTask: Task<Void, Never>?
  private var requestID: UUID?

  public init(
    api: any DiscussionAnalysisAPI,
    cache: DiscussionTimelineCache,
    session: DiscussionSessionState = DiscussionSessionState()
  ) {
    self.api = api
    self.cache = cache
    self.session = session
  }

  deinit {
    requestTask?.cancel()
  }

  public func submit(_ text: String, forceRefresh: Bool = false) {
    guard let parsed = DiscussionYouTubeURL.parse(text) else {
      state = .failure(.invalidURL)
      return
    }

    requestTask?.cancel()
    let id = UUID()
    requestID = id
    submittedURL = parsed.url.absoluteString
    state = .submitting(videoId: parsed.videoId)
    requestTask = Task { [weak self] in
      await self?.load(parsed, forceRefresh: forceRefresh, requestID: id)
    }
  }

  public func retry() {
    guard case let .failure(failure) = state, failure.retryable, !submittedURL.isEmpty else { return }
    submit(submittedURL, forceRefresh: true)
  }

  public func refresh() {
    guard !submittedURL.isEmpty else { return }
    submit(submittedURL, forceRefresh: true)
  }

  public func cancel() {
    requestTask?.cancel()
    requestTask = nil
    requestID = nil
    restoreReadyState()
  }

  @discardableResult
  public func receive(_ playback: DiscussionPlaybackState) -> [DiscussionEvent] {
    session.receive(playback)
  }

  private func load(
    _ parsed: (url: URL, videoId: String),
    forceRefresh: Bool,
    requestID id: UUID
  ) async {
    if !forceRefresh, let cached = await cache.value(for: parsed.videoId) {
      activate(cached, expectedVideoId: parsed.videoId, source: .cache, requestID: id)
      return
    }

    guard isCurrent(id) else { return }
    state = .processing(videoId: parsed.videoId)

    do {
      while isCurrent(id) {
        switch try await api.analyze(url: parsed.url, forceRefresh: forceRefresh) {
        case let .analysis(analysis):
          guard isCurrent(id) else { return }
          guard analysis.videoId == parsed.videoId else {
            state = .failure(.invalidResponse)
            requestTask = nil
            return
          }
          // A cache write failure must not discard a valid network response.
          try? await cache.store(analysis)
          activate(analysis, expectedVideoId: parsed.videoId, source: .network, requestID: id)
          return
        case let .processing(retryAfter):
          guard isCurrent(id) else { return }
          state = .processing(videoId: parsed.videoId)
          try await Task.sleep(for: retryAfter)
        }
      }
    } catch is CancellationError {
      return
    } catch DiscussionAnalysisClientError.cancelled {
      return
    } catch {
      guard isCurrent(id) else { return }
      state = .failure(Self.failure(from: error))
      requestTask = nil
    }
  }

  private func activate(
    _ analysis: DiscussionAnalysis,
    expectedVideoId: String,
    source: DiscussionAnalysisSource,
    requestID id: UUID
  ) {
    guard isCurrent(id), analysis.videoId == expectedVideoId else {
      if isCurrent(id) { state = .failure(.invalidResponse) }
      return
    }
    do {
      try session.load(analysis)
      state = .ready(videoId: analysis.videoId, eventCount: analysis.events.count, source: source)
      requestTask = nil
    } catch DiscussionContractError.unsupportedSchemaVersion {
      state = .failure(.updateRequired)
    } catch {
      state = .failure(.invalidResponse)
    }
  }

  private func isCurrent(_ id: UUID) -> Bool {
    requestID == id && !Task.isCancelled
  }

  private func restoreReadyState() {
    if let analysis = session.analysis {
      state = .ready(videoId: analysis.videoId, eventCount: analysis.events.count, source: .cache)
    } else {
      state = .empty
    }
  }

  private static func failure(from error: Error) -> DiscussionAnalysisFailure {
    guard let clientError = error as? DiscussionAnalysisClientError else {
      return .backend(message: "Analysis couldn’t be completed.", retryable: true)
    }
    switch clientError {
    case .cancelled:
      return .backend(message: "Analysis cancelled.", retryable: true)
    case .offline, .timedOut:
      return .offline
    case .invalidResponse:
      return .invalidResponse
    case .unsupportedSchemaVersion:
      return .updateRequired
    case let .server(detail):
      switch detail.code {
      case .unsupportedSchemaVersion:
        return .updateRequired
      case .videoPrivate, .videoNotFound, .captionsDisabled, .unsupportedLanguage,
        .transcriptUnavailable:
        return .noTranscript(message: detail.message, retryable: detail.retryable)
      case .invalidRequest, .invalidYouTubeURL:
        return .backend(message: "This video can’t be analyzed.", retryable: false)
      case .analysisFailed, .upstreamTimeout, .internalError:
        return .backend(message: detail.message, retryable: detail.retryable)
      }
    }
  }
}
