import Foundation

public enum DiscussionAPIErrorCode: String, Codable, Sendable {
  case invalidRequest = "INVALID_REQUEST"
  case invalidYouTubeURL = "INVALID_YOUTUBE_URL"
  case unsupportedSchemaVersion = "UNSUPPORTED_SCHEMA_VERSION"
  case videoPrivate = "VIDEO_PRIVATE"
  case videoNotFound = "VIDEO_NOT_FOUND"
  case captionsDisabled = "CAPTIONS_DISABLED"
  case unsupportedLanguage = "UNSUPPORTED_LANGUAGE"
  case transcriptUnavailable = "TRANSCRIPT_UNAVAILABLE"
  case analysisFailed = "ANALYSIS_FAILED"
  case upstreamTimeout = "UPSTREAM_TIMEOUT"
  case internalError = "INTERNAL_ERROR"
}

public struct DiscussionAPIErrorPayload: Codable, Equatable, Sendable {
  public struct Detail: Codable, Equatable, Sendable {
    public let code: DiscussionAPIErrorCode
    public let message: String
    public let retryable: Bool
    public let requestId: String?

    public init(
      code: DiscussionAPIErrorCode,
      message: String,
      retryable: Bool,
      requestId: String? = nil
    ) {
      self.code = code
      self.message = message
      self.retryable = retryable
      self.requestId = requestId
    }
  }

  public let schemaVersion: Int
  public let error: Detail

  public init(schemaVersion: Int, error: Detail) {
    self.schemaVersion = schemaVersion
    self.error = error
  }
}

public enum DiscussionAnalysisAPIResult: Equatable, Sendable {
  case analysis(DiscussionAnalysis)
  case processing(retryAfter: Duration)
}

public enum DiscussionAnalysisClientError: Error, Equatable, Sendable {
  case cancelled
  case offline
  case timedOut
  case server(DiscussionAPIErrorPayload.Detail)
  case invalidResponse
  case unsupportedSchemaVersion
}

public protocol DiscussionAnalysisAPI: Sendable {
  func analyze(url: URL, forceRefresh: Bool) async throws -> DiscussionAnalysisAPIResult
}

public struct URLSessionDiscussionAnalysisAPI: DiscussionAnalysisAPI {
  private struct RequestBody: Encodable {
    let url: String
    let forceRefresh: Bool
  }

  private struct ProcessingResponse: Decodable {
    let schemaVersion: Int
    let status: String
    let retryAfterSeconds: Double?
  }

  public let baseURL: URL
  public let requestTimeout: TimeInterval
  private let session: URLSession

  public init(
    baseURL: URL,
    requestTimeout: TimeInterval = 45,
    session: URLSession = .shared
  ) {
    self.baseURL = baseURL
    self.requestTimeout = requestTimeout
    self.session = session
  }

  public func analyze(url: URL, forceRefresh: Bool) async throws -> DiscussionAnalysisAPIResult {
    let endpoint = baseURL.appendingPathComponent("v1/analyze")
    var request = URLRequest(url: endpoint, timeoutInterval: requestTimeout)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.setValue("application/json", forHTTPHeaderField: "accept")
    request.httpBody = try JSONEncoder().encode(RequestBody(url: url.absoluteString, forceRefresh: forceRefresh))

    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: request)
    } catch is CancellationError {
      throw DiscussionAnalysisClientError.cancelled
    } catch let error as URLError {
      switch error.code {
      case .cancelled:
        throw DiscussionAnalysisClientError.cancelled
      case .timedOut:
        throw DiscussionAnalysisClientError.timedOut
      case .notConnectedToInternet, .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed,
        .networkConnectionLost:
        throw DiscussionAnalysisClientError.offline
      default:
        throw DiscussionAnalysisClientError.offline
      }
    }

    guard let http = response as? HTTPURLResponse else {
      throw DiscussionAnalysisClientError.invalidResponse
    }

    if http.statusCode == 202 {
      guard let processing = try? JSONDecoder().decode(ProcessingResponse.self, from: data),
        processing.schemaVersion == DiscussionAnalysis.supportedSchemaVersion,
        processing.status == "processing"
      else {
        throw DiscussionAnalysisClientError.invalidResponse
      }
      let headerDelay = http.value(forHTTPHeaderField: "retry-after").flatMap(Double.init)
      let seconds = min(max(processing.retryAfterSeconds ?? headerDelay ?? 3, 0.25), 30)
      return .processing(retryAfter: .milliseconds(Int64(seconds * 1_000)))
    }

    guard (200..<300).contains(http.statusCode) else {
      guard data.count <= 16_384,
        let payload = try? JSONDecoder().decode(DiscussionAPIErrorPayload.self, from: data),
        payload.schemaVersion == DiscussionAnalysis.supportedSchemaVersion
      else {
        throw DiscussionAnalysisClientError.invalidResponse
      }
      throw DiscussionAnalysisClientError.server(payload.error)
    }

    do {
      let analysis = try DiscussionJSON.makeDecoder().decode(DiscussionAnalysis.self, from: data)
      try analysis.validate()
      return .analysis(analysis)
    } catch DiscussionContractError.unsupportedSchemaVersion {
      throw DiscussionAnalysisClientError.unsupportedSchemaVersion
    } catch {
      throw DiscussionAnalysisClientError.invalidResponse
    }
  }
}

public enum DiscussionYouTubeURL {
  public static func parse(_ text: String) -> (url: URL, videoId: String)? {
    guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
      ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
      let host = url.host?.lowercased()
    else { return nil }

    let candidate: String?
    if host == "youtu.be" || host == "www.youtu.be" {
      candidate = url.pathComponents.dropFirst().first
    } else if ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].contains(host) {
      if url.path == "/watch" {
        candidate = URLComponents(url: url, resolvingAgainstBaseURL: false)?
          .queryItems?.first(where: { $0.name == "v" })?.value
      } else if url.pathComponents.count > 2,
        ["shorts", "embed", "live"].contains(url.pathComponents[1])
      {
        candidate = url.pathComponents[2]
      } else {
        candidate = nil
      }
    } else {
      candidate = nil
    }

    guard let candidate, DiscussionAnalysis.isValidYouTubeVideoID(candidate) else { return nil }
    return (url, candidate)
  }
}
