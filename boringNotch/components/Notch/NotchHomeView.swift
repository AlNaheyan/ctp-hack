//
//  NotchHomeView.swift
//  boringNotch
//
//  The discussion analyzer's complete expanded surface: URL input, read-only
//  YouTube playback position, and the currently relevant argument insight.
//

import Combine
import DiscussionTimeline
import SwiftUI

struct DiscussionPlaybackSnapshot: Equatable, Sendable {
    var videoId: String?
    var currentTime: Double = 0
    var duration: Double = 0
    var paused = true
    var playbackRate: Double = 1
}

struct DiscussionInsight: Identifiable, Equatable, Sendable {
    enum Kind: String, Sendable {
        case unsupportedClaim = "unsupported_claim"
        case contradiction
        case strawman
        case evasion
        case missingPremise = "missing_premise"

        var label: String {
            switch self {
            case .unsupportedClaim: "Needs support"
            case .contradiction: "Possible contradiction"
            case .strawman: "Position may be reframed"
            case .evasion: "Question may be unanswered"
            case .missingPremise: "Reasoning skips a step"
            }
        }

        var symbol: String {
            switch self {
            case .unsupportedClaim: "questionmark.bubble"
            case .contradiction: "arrow.triangle.2.circlepath"
            case .strawman: "person.2"
            case .evasion: "arrow.turn.up.right"
            case .missingPremise: "link.badge.plus"
            }
        }

        var color: Color {
            switch self {
            case .unsupportedClaim: .orange
            case .contradiction: .purple
            case .strawman: .orange
            case .evasion: .blue
            case .missingPremise: .teal
            }
        }
    }

    let id: String
    let triggerTime: Double
    let kind: Kind
    let title: String
    let summary: String
    let speaker: String
    let confidence: Double
}

@MainActor
final class DiscussionSessionModel: ObservableObject {
    enum Status: Equatable {
        case empty
        case submitting
        case processing
        case ready(eventCount: Int, cached: Bool)
        case invalidURL
        case browserDisconnected
        case noTranscript(message: String, retryable: Bool)
        case offline
        case backend(message: String, retryable: Bool)
        case updateRequired

        var message: String {
            switch self {
            case .empty: "Paste a YouTube discussion link"
            case .submitting: "Sending video…"
            case .processing: "Analyzing discussion…"
            case let .ready(eventCount, cached):
                cached ? "Ready from saved analysis · \(eventCount) insights" : "Ready · \(eventCount) insights"
            case .invalidURL: "Enter a valid YouTube video link"
            case .browserDisconnected: "Waiting for YouTube playback…"
            case let .noTranscript(message, _): message
            case .offline: "Can’t reach the analyzer"
            case let .backend(message, _): message
            case .updateRequired: "Update the app and try again"
            }
        }

        var isLoading: Bool {
            self == .submitting || self == .processing
        }

        var canRetry: Bool {
            switch self {
            case .offline: true
            case let .noTranscript(_, retryable), let .backend(_, retryable): retryable
            default: false
            }
        }
    }

    static let shared = DiscussionSessionModel()

    @Published var youtubeURL = ""
    @Published private(set) var selectedVideoId: String?
    @Published private(set) var playback = DiscussionPlaybackSnapshot()
    @Published private(set) var activeInsight: DiscussionInsight?
    @Published private(set) var status: Status = .empty

    private let coordinator: DiscussionAnalysisCoordinator
    private var observations = Set<AnyCancellable>()

    init(coordinator: DiscussionAnalysisCoordinator? = nil) {
        self.coordinator = coordinator ?? Self.makeCoordinator()
        self.coordinator.$state
            .receive(on: RunLoop.main)
            .sink { [weak self] state in self?.apply(state) }
            .store(in: &observations)
    }

    func submit() {
        activeInsight = nil
        coordinator.submit(youtubeURL)
    }

    func cancelSubmission() {
        coordinator.cancel()
    }

    func retry() {
        coordinator.retry()
    }

    func refresh() {
        coordinator.refresh()
    }

    /// W3-T2 calls this with browser-owned time. The progress bar is deliberately
    /// read-only, so the app never seeks or advances YouTube itself.
    func receivePlayback(_ snapshot: DiscussionPlaybackSnapshot) {
        playback = snapshot
        guard let videoId = snapshot.videoId else { return }
        let update = DiscussionPlaybackState(
            videoId: videoId,
            currentTime: snapshot.currentTime,
            duration: snapshot.duration,
            paused: snapshot.paused,
            playbackRate: snapshot.playbackRate,
            observedAt: Date()
        )
        for event in coordinator.receive(update) {
            guard let insight = Self.insight(from: event) else { continue }
            present(insight)
        }
    }

    /// The timeline coordinator presents only the event that won arbitration.
    func present(_ insight: DiscussionInsight) {
        activeInsight = insight
    }

    func dismissInsight() {
        activeInsight = nil
    }

    func connectionLost() {
        status = .browserDisconnected
    }

    private func apply(_ state: DiscussionAnalysisLoadingState) {
        switch state {
        case .empty:
            status = .empty
        case .submitting:
            status = .submitting
        case .processing:
            status = .processing
        case let .ready(videoId, eventCount, source):
            selectedVideoId = videoId
            activeInsight = nil
            status = .ready(eventCount: eventCount, cached: source == .cache)
        case let .failure(failure):
            switch failure {
            case .invalidURL: status = .invalidURL
            case let .noTranscript(message, retryable):
                status = .noTranscript(message: message, retryable: retryable)
            case .offline: status = .offline
            case let .backend(message, retryable):
                status = .backend(message: message, retryable: retryable)
            case .invalidResponse:
                status = .backend(message: "Analysis response was invalid", retryable: true)
            case .updateRequired: status = .updateRequired
            }
        }
    }

    private static func makeCoordinator() -> DiscussionAnalysisCoordinator {
        let configured = ProcessInfo.processInfo.environment["DISCUSSION_API_BASE_URL"]
        let baseURL = URL(string: configured ?? "http://127.0.0.1:8787")!
        let storage: any DiscussionCacheStorage
        if let directory = try? FileDiscussionCacheStorage.defaultDirectory(),
           let files = try? FileDiscussionCacheStorage(directory: directory) {
            storage = files
        } else {
            storage = EphemeralDiscussionCacheStorage()
        }
        return DiscussionAnalysisCoordinator(
            api: URLSessionDiscussionAnalysisAPI(baseURL: baseURL),
            cache: DiscussionTimelineCache(storage: storage)
        )
    }

    private static func insight(from event: DiscussionEvent) -> DiscussionInsight? {
        guard let kind = DiscussionInsight.Kind(rawValue: event.type) else { return nil }
        return DiscussionInsight(
            id: event.id,
            triggerTime: event.triggerTime,
            kind: kind,
            title: event.title,
            summary: event.summary,
            speaker: event.speaker ?? "Unknown speaker",
            confidence: event.confidence
        )
    }
}

private actor EphemeralDiscussionCacheStorage: DiscussionCacheStorage {
    private var values: [String: Data] = [:]
    func read(key: String) async throws -> Data? { values[key] }
    func write(_ data: Data, key: String) async throws { values[key] = data }
    func remove(key: String) async throws { values[key] = nil }
    func keys() async throws -> [String] { Array(values.keys) }
}

struct NotchHomeView: View {
    @ObservedObject var model: DiscussionSessionModel
    @FocusState private var linkFocused: Bool

    var body: some View {
        VStack(spacing: 10) {
            linkInput
            PlaybackPositionView(snapshot: model.playback)

            if let insight = model.activeInsight {
                DiscussionInsightCard(insight: insight, onDismiss: model.dismissInsight)
                    .transition(.move(edge: .top).combined(with: .opacity))
            } else {
                HStack(alignment: .top, spacing: 7) {
                    if model.status.isLoading {
                        ProgressView()
                            .controlSize(.small)
                    }
                    Text(model.status.message)
                        .font(.caption)
                        .foregroundStyle(model.status == .invalidURL ? Color.red : Color.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .padding(.horizontal, 4)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: model.activeInsight?.id)
    }

    private var linkInput: some View {
        HStack(spacing: 8) {
            Image(systemName: "link")
                .foregroundStyle(.secondary)

            TextField("Paste a YouTube link", text: $model.youtubeURL)
                .textFieldStyle(.plain)
                .focused($linkFocused)
                .onSubmit(model.submit)
                .disabled(model.status.isLoading)
                .accessibilityLabel("YouTube discussion link")

            Button(action: model.status.isLoading ? model.cancelSubmission : model.submit) {
                Image(systemName: model.status.isLoading ? "xmark" : "arrow.right")
                    .font(.system(size: 12, weight: .semibold))
                    .frame(width: 24, height: 24)
                    .background(.white, in: Circle())
                    .foregroundStyle(.black)
            }
            .buttonStyle(.plain)
            .help(model.status.isLoading ? "Cancel analysis" : "Analyze this YouTube discussion")
            .accessibilityLabel(model.status.isLoading ? "Cancel analysis" : "Analyze discussion")

            if model.status.canRetry {
                Button("Retry", action: model.retry)
                    .buttonStyle(.plain)
                    .font(.caption.weight(.semibold))
                    .accessibilityLabel("Retry analysis")
            } else if case .ready = model.status {
                Button(action: model.refresh) {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.plain)
                .help("Refresh analysis")
                .accessibilityLabel("Refresh analysis")
            }
        }
        .padding(.horizontal, 10)
        .frame(height: 32)
        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
        .overlay {
            RoundedRectangle(cornerRadius: 10)
                .stroke(linkFocused ? Color.white.opacity(0.45) : Color.white.opacity(0.1))
        }
    }
}

private struct PlaybackPositionView: View {
    let snapshot: DiscussionPlaybackSnapshot

    private var progress: Double {
        guard snapshot.duration > 0 else { return 0 }
        return min(max(snapshot.currentTime / snapshot.duration, 0), 1)
    }

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: snapshot.paused ? "pause.fill" : "play.fill")
                .font(.caption)
                .foregroundStyle(snapshot.videoId == nil ? Color.secondary : Color.white)
                .frame(width: 14)

            Text(time(snapshot.currentTime))
                .monospacedDigit()

            GeometryReader { geometry in
                let filledWidth = geometry.size.width * progress
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.14))
                    Capsule().fill(Color.white).frame(width: filledWidth)
                    Circle()
                        .fill(.white)
                        .frame(width: 8, height: 8)
                        .offset(x: max(0, min(filledWidth - 4, geometry.size.width - 8)))
                }
            }
            .frame(height: 6)
            .accessibilityElement()
            .accessibilityLabel("YouTube playback position")
            .accessibilityValue("\(time(snapshot.currentTime)) of \(time(snapshot.duration))")
            .help("Synced from YouTube · read-only")

            Text(time(snapshot.duration))
                .monospacedDigit()

            if snapshot.playbackRate != 1 {
                Text("\(snapshot.playbackRate, specifier: "%.1f")×")
                    .foregroundStyle(.secondary)
            }
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
        .frame(height: 18)
        .padding(.horizontal, 4)
    }

    private func time(_ seconds: Double) -> String {
        let safeSeconds = max(0, Int(seconds.rounded(.down)))
        let hours = safeSeconds / 3_600
        let minutes = (safeSeconds % 3_600) / 60
        let remainder = safeSeconds % 60
        return hours > 0
            ? String(format: "%d:%02d:%02d", hours, minutes, remainder)
            : String(format: "%d:%02d", minutes, remainder)
    }
}

private struct DiscussionInsightCard: View {
    let insight: DiscussionInsight
    let onDismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: insight.kind.symbol)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(insight.kind.color)
                .frame(width: 26, height: 26)
                .help(insight.kind.label)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(insight.kind.label.uppercased())
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(insight.kind.color)
                    Text("·")
                    Text(insight.speaker)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Text(time(insight.triggerTime))
                        .monospacedDigit()
                }
                .font(.caption2)
                .foregroundStyle(.secondary)

                Text(insight.title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)

                Text(insight.summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            .help("\(insight.title)\n\(insight.summary)")

            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.caption.weight(.bold))
                    .frame(width: 22, height: 22)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .help("Dismiss insight")
            .accessibilityLabel("Dismiss insight")
        }
        .padding(10)
        .background(insight.kind.color.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .stroke(insight.kind.color.opacity(0.28))
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "Discussion insight, \(insight.kind.label), \(insight.title), at \(time(insight.triggerTime))"
        )
    }

    private func time(_ seconds: Double) -> String {
        let total = max(0, Int(seconds.rounded(.down)))
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}

#Preview("Discussion insight") {
    let model = DiscussionSessionModel()
    model.youtubeURL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    model.receivePlayback(
        DiscussionPlaybackSnapshot(
            videoId: "dQw4w9WgXcQ",
            currentTime: 342.8,
            duration: 1_204,
            paused: false,
            playbackRate: 1
        )
    )
    model.present(
        DiscussionInsight(
            id: "preview-insight",
            triggerTime: 342.8,
            kind: .unsupportedClaim,
            title: "The numerical claim is presented without a source",
            summary: "The speaker gives a percentage but does not identify evidence or a time period.",
            speaker: "Speaker A",
            confidence: 0.91
        )
    )

    return NotchHomeView(model: model)
        .padding(12)
        .frame(width: 640, height: 160)
        .background(.black)
        .preferredColorScheme(.dark)
}
