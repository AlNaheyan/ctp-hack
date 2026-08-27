import AppKit
import Combine
import DiscussionTimeline
import SwiftUI

@MainActor
final class DiscussionPresentationModel: ObservableObject {
    static let shared = DiscussionPresentationModel()

    @Published private(set) var queue = DiscussionPresentationQueue()
    @Published private(set) var videoId: String?
    @Published private(set) var isExpanded = false

    var activeEvent: DiscussionEvent? { queue.active }
    var waitingCount: Int { queue.waiting.count }

    private let clock = ContinuousClock()
    private var deadlineTask: Task<Void, Never>?
    private var streamTask: Task<Void, Never>?
    private var startedAt: ContinuousClock.Instant?
    private var remainingSeconds: Double = 0
    private var isHovered = false
    private var isPlaybackPaused = false
    private var isInterrupted = false

    init() {}

    func bind(to session: DiscussionSessionState) {
        streamTask?.cancel()
        streamTask = Task { @MainActor [weak self] in
            for await event in session.events {
                guard !Task.isCancelled else { return }
                self?.setPlaybackPaused(session.playback?.paused ?? false)
                self?.receive([event], videoId: session.analysis?.videoId)
            }
        }
    }

    /// Public W3 integration hook. Events must arrive in timeline order.
    func receive(_ events: [DiscussionEvent], videoId: String?) {
        guard !events.isEmpty else { return }
        if self.videoId != videoId, activeEvent != nil {
            clear()
        }

        self.videoId = videoId
        let previousID = activeEvent?.id
        queue.enqueue(events)
        if activeEvent?.id != previousID {
            beginActiveCard()
        }
    }

    func dismiss() {
        deadlineTask?.cancel()
        startedAt = nil
        queue.dismissActive()
        if activeEvent == nil {
            remainingSeconds = 0
        } else {
            beginActiveCard()
        }
    }

    func clear() {
        deadlineTask?.cancel()
        startedAt = nil
        remainingSeconds = 0
        videoId = nil
        queue.clear()
    }

    func setExpanded(_ expanded: Bool) {
        guard isExpanded != expanded else { return }
        freezeDeadline()
        isExpanded = expanded
        if expanded, activeEvent != nil {
            remainingSeconds = max(remainingSeconds, 8)
        }
        resumeDeadlineIfNeeded()
    }

    func setHovered(_ hovered: Bool) {
        guard isHovered != hovered else { return }
        isHovered = hovered
        hovered ? freezeDeadline() : resumeDeadlineIfNeeded(minimum: 3)
    }

    func setPlaybackPaused(_ paused: Bool) {
        guard isPlaybackPaused != paused else { return }
        isPlaybackPaused = paused
        paused ? freezeDeadline() : resumeDeadlineIfNeeded(minimum: 3)
    }

    func setInterrupted(_ interrupted: Bool) {
        guard isInterrupted != interrupted else { return }
        isInterrupted = interrupted
        interrupted ? freezeDeadline() : resumeDeadlineIfNeeded(minimum: 3)
    }

    func openActiveEvent() {
        guard let event = activeEvent,
              let videoId,
              videoId.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil,
              var components = URLComponents(string: "https://www.youtube.com/watch")
        else { return }

        components.queryItems = [
            URLQueryItem(name: "v", value: videoId),
            URLQueryItem(name: "t", value: "\(max(0, Int(event.startTime.rounded(.down))))s"),
        ]
        guard let url = components.url else { return }
        NSWorkspace.shared.open(url)
    }

    private func beginActiveCard() {
        remainingSeconds = isExpanded ? 15 : 8
        resumeDeadlineIfNeeded()
    }

    private func freezeDeadline() {
        deadlineTask?.cancel()
        deadlineTask = nil
        guard let startedAt else { return }
        remainingSeconds = max(0, remainingSeconds - seconds(startedAt.duration(to: clock.now)))
        self.startedAt = nil
    }

    private func resumeDeadlineIfNeeded(minimum: Double = 0) {
        guard activeEvent != nil, !isHovered, !isPlaybackPaused, !isInterrupted else { return }
        deadlineTask?.cancel()
        remainingSeconds = max(remainingSeconds, minimum)
        guard remainingSeconds > 0 else {
            dismiss()
            return
        }

        startedAt = clock.now
        let delay = remainingSeconds
        deadlineTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard let self, !Task.isCancelled else { return }
            self.startedAt = nil
            self.dismiss()
        }
    }

    private func seconds(_ duration: Duration) -> Double {
        let components = duration.components
        return Double(components.seconds) + Double(components.attoseconds) / 1e18
    }
}

struct CompactDiscussionInsightCard: View {
    let event: DiscussionEvent
    let onDismiss: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isHovering = false

    private var style: DiscussionInsightStyle { .init(type: event.type, confidence: event.confidence) }

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: style.symbol)
                .foregroundStyle(style.accent)

            Text(event.title)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(minWidth: 80, maxWidth: .infinity, alignment: .leading)

            Text(discussionTime(event.triggerTime))
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
                .fixedSize()

            if isHovering {
                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.caption2.weight(.bold))
                        .frame(width: 18, height: 18)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Dismiss insight")
            }
        }
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .foregroundStyle(.white)
        .background(.black)
        .onHover { isHovering = $0 }
        .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            "Discussion insight, \(style.label), \(event.title), at \(discussionTime(event.triggerTime))"
        )
        .help(event.title)
    }
}

struct ExpandedDiscussionInsightCard: View {
    let event: DiscussionEvent
    let waitingCount: Int
    let onOpen: () -> Void
    let onDismiss: () -> Void
    let onHover: (Bool) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var style: DiscussionInsightStyle { .init(type: event.type, confidence: event.confidence) }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: style.symbol)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(style.accent)
                .frame(width: 26, height: 26)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                metadata

                Text(event.title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(2)
                    .help(event.title)

                Text(event.summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                    .help(event.summary)

                Spacer(minLength: 0)

                HStack(spacing: 8) {
                    if !event.evidence.isEmpty {
                        Text("“\(event.evidence)”")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                            .help(event.evidence)
                    }
                    Spacer(minLength: 4)
                    Button("Open at \(discussionTime(event.startTime))", action: onOpen)
                        .buttonStyle(.borderless)
                    Button("Dismiss", action: onDismiss)
                        .buttonStyle(.borderless)
                        .keyboardShortcut(.cancelAction)
                }
                .font(.caption)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(style.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .stroke(style.accent.opacity(0.32))
        }
        .contentShape(Rectangle())
        .onHover(perform: onHover)
        .onExitCommand(perform: onDismiss)
        .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            "Discussion insight, \(style.label), \(event.title), at \(discussionTime(event.triggerTime))"
        )
        .accessibilityValue(
            [event.summary, event.speaker, style.confidenceLabel].compactMap { $0 }.joined(separator: ", ")
        )
    }

    private var metadata: some View {
        HStack(spacing: 6) {
            Text(style.label.uppercased())
                .font(.caption2.weight(.bold))
                .foregroundStyle(style.accent)
            if let speaker = event.speaker, !speaker.isEmpty {
                Text("·")
                Text(speaker).lineLimit(1)
            }
            Text("·")
            Text(style.confidenceLabel)
                .foregroundStyle(event.confidence < 0.6 ? Color.secondary : style.accent)
            if event.confidence < 0.6 {
                Text("· Review context")
            }
            Spacer(minLength: 4)
            if waitingCount > 0 {
                Text("+\(waitingCount)")
                    .accessibilityLabel("\(waitingCount) more insights")
            }
            Text(discussionTime(event.triggerTime)).monospacedDigit()
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
    }
}

enum DiscussionRecoveryPreviewState: String, CaseIterable, Identifiable {
    case disconnected
    case noTranscript
    case offline
    case backendError

    var id: Self { self }

    var content: (symbol: String, title: String, detail: String, action: String) {
        switch self {
        case .disconnected:
            ("link.badge.plus", "Chrome disconnected", "Open Chrome and play this video.", "Retry connection")
        case .noTranscript:
            ("captions.bubble", "No transcript available", "Try a video with public captions.", "Try another video")
        case .offline:
            ("wifi.slash", "Can’t reach the analyzer", "Your current analysis is safe.", "Retry")
        case .backendError:
            ("exclamationmark.triangle", "Analysis couldn’t be completed", "The analyzer returned an error.", "Retry")
        }
    }
}

struct DiscussionRecoveryCard: View {
    let state: DiscussionRecoveryPreviewState
    var action: () -> Void = {}

    var body: some View {
        let content = state.content
        HStack(spacing: 12) {
            Image(systemName: content.symbol)
                .font(.title3)
                .foregroundStyle(.orange)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(content.title).font(.subheadline.weight(.semibold))
                Text(content.detail).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button(content.action, action: action).buttonStyle(.borderless)
        }
        .padding(12)
        .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .contain)
    }
}

private struct DiscussionInsightStyle {
    let label: String
    let symbol: String
    let accent: Color
    let confidenceLabel: String

    init(type: String, confidence: Double) {
        switch type {
        case "unsupported_claim":
            (label, symbol, accent) = ("Needs support", "questionmark.bubble", .orange)
        case "contradiction":
            (label, symbol, accent) = ("Possible contradiction", "arrow.triangle.2.circlepath", .purple)
        case "strawman":
            (label, symbol, accent) = ("Position may be reframed", "person.2", .orange)
        case "evasion":
            (label, symbol, accent) = ("Question may be unanswered", "arrow.turn.up.right", .blue)
        case "missing_premise":
            (label, symbol, accent) = ("Reasoning skips a step", "link.badge.plus", .teal)
        default:
            (label, symbol, accent) = ("Insight", "text.bubble", .blue)
        }

        confidenceLabel = confidence >= 0.8
            ? "High confidence"
            : confidence >= 0.6 ? "Medium confidence" : "Low confidence"
    }
}

private func discussionTime(_ seconds: Double) -> String {
    let total = max(0, Int(seconds.rounded(.down)))
    let hours = total / 3_600
    let minutes = (total % 3_600) / 60
    let remainder = total % 60
    return hours > 0
        ? String(format: "%d:%02d:%02d", hours, minutes, remainder)
        : String(format: "%d:%02d", minutes, remainder)
}

#Preview("Long insight") {
    ExpandedDiscussionInsightCard(
        event: .longPreview,
        waitingCount: 2,
        onOpen: {},
        onDismiss: {},
        onHover: { _ in }
    )
    .padding(12)
    .frame(width: 640, height: 142)
    .background(.black)
    .preferredColorScheme(.dark)
}

#Preview("Compact insight") {
    CompactDiscussionInsightCard(event: .longPreview, onDismiss: {})
        .frame(width: 360, height: 38)
        .background(.black)
        .preferredColorScheme(.dark)
}

#Preview("Rapid events") {
    ExpandedDiscussionInsightCard(
        event: .longPreview,
        waitingCount: 3,
        onOpen: {},
        onDismiss: {},
        onHover: { _ in }
    )
    .padding(12)
    .frame(width: 640, height: 142)
    .background(.black)
    .preferredColorScheme(.dark)
}

#Preview("Recovery states") {
    VStack {
        ForEach(DiscussionRecoveryPreviewState.allCases) { state in
            DiscussionRecoveryCard(state: state)
        }
    }
    .padding()
    .frame(width: 640)
    .background(.black)
    .preferredColorScheme(.dark)
}

private extension DiscussionEvent {
    static let longPreview = DiscussionEvent(
        id: "preview-long",
        startTime: 3_598,
        triggerTime: 3_599,
        endTime: 3_605,
        speaker: "Dr. Alexandra Montgomery-Rodríguez",
        type: "unsupported_claim",
        title: "The speaker attributes a multi-decade decline in neighborhood-level institutional trust entirely to one policy change without establishing causality",
        summary: "The claim compresses several distinct measures, time periods, and possible causes into one conclusion. The comparison establishes correlation but does not isolate the policy.",
        confidence: 0.59,
        evidence: "That single decision explains the rest."
    )
}
