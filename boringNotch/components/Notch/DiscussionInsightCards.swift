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
    var onPreferredHeightChange: (CGFloat) -> Void = { _ in }

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
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .help(event.title)

                ScrollView(.vertical) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(event.summary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .help(event.summary)

                        if !event.evidence.isEmpty {
                            Text("“\(event.evidence)”")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                                .fixedSize(horizontal: false, vertical: true)
                                .help(event.evidence)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.trailing, 4)
                }
                .scrollIndicators(.automatic)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .contentShape(Rectangle())
                .textSelection(.enabled)

                HStack(spacing: 8) {
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
        .onAppear { onPreferredHeightChange(preferredCardHeight) }
        .onChange(of: event.id) { _, _ in onPreferredHeightChange(preferredCardHeight) }
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

    private var preferredCardHeight: CGFloat {
        // Available text width at the standard 640-point notch width after the
        // outer inset, card padding, icon column, and spacing are removed.
        let textWidth: CGFloat = 500
        let titleHeight = measuredHeight(
            event.title,
            font: .systemFont(ofSize: NSFont.smallSystemFontSize, weight: .semibold),
            width: textWidth
        )
        let summaryHeight = measuredHeight(
            event.summary,
            font: .systemFont(ofSize: NSFont.smallSystemFontSize),
            width: textWidth
        )
        let evidenceHeight = event.evidence.isEmpty
            ? 0
            : measuredHeight(
                "“\(event.evidence)”",
                font: .systemFont(ofSize: NSFont.smallSystemFontSize - 1),
                width: textWidth
            ) + 6

        // Metadata, action row, card padding, and VStack spacing are fixed.
        return ceil(68 + titleHeight + summaryHeight + evidenceHeight)
    }
}

private func measuredHeight(_ text: String, font: NSFont, width: CGFloat) -> CGFloat {
    guard !text.isEmpty else { return 0 }
    return ceil(
        (text as NSString).boundingRect(
            with: CGSize(width: width, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: [.font: font]
        ).height
    )
}

// MARK: - Insight rail (direction 1b)

/// The read-only playback bar as the spine of the analysis: every analyzed
/// moment is a tick colored by insight type, the active one a lifted pill at
/// the playhead. Display-only — it must never become a scrubber.
struct DiscussionInsightRailView: View {
    let events: [DiscussionEvent]
    let activeEventID: String?
    let currentTime: Double
    let duration: Double

    private struct Tick: Identifiable {
        let id: String
        let position: Double
        let accent: Color
        let isPassed: Bool
        let isActive: Bool
        let tooltip: String
    }

    private var progress: Double {
        guard duration > 0 else { return 0 }
        return min(max(currentTime / duration, 0), 1)
    }

    /// Ticks are positioned by `triggerTime / duration`. With no matching
    /// playback yet, the last analyzed moment spans the track so the shape of
    /// the discussion is still visible.
    private var ticks: [Tick] {
        let total = duration > 0 ? duration : (events.map(\.endTime).max() ?? 0)
        guard total > 0 else { return [] }

        var result: [Tick] = []
        for event in events {
            let style = DiscussionInsightStyle(type: event.type, confidence: event.confidence)
            let tick = Tick(
                id: event.id,
                position: min(max(event.triggerTime / total, 0), 1),
                accent: style.accent,
                isPassed: event.triggerTime <= currentTime,
                isActive: event.id == activeEventID,
                tooltip: "\(style.label) · \(event.title) · \(discussionTime(event.triggerTime))"
            )
            // Overlapping ticks (< 1% apart) merge into the earlier one; the
            // active pill always draws.
            if !tick.isActive, let last = result.last, !last.isActive,
               tick.position - last.position < 0.01 {
                continue
            }
            result.append(tick)
        }
        return result
    }

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            ZStack(alignment: .topLeading) {
                Capsule()
                    .fill(Color.white.opacity(0.12))
                    .frame(width: width, height: 4)
                    .offset(y: 9)

                Capsule()
                    .fill(Color.white.opacity(0.5))
                    .frame(width: width * progress, height: 4)
                    .offset(y: 9)

                ForEach(ticks) { tick in
                    railTick(tick, railWidth: width)
                }
            }
        }
        .frame(height: 22)
        // Passed/ahead counts and the card carry this information for
        // assistive tech; the rail itself is a visual summary.
        .accessibilityHidden(true)
        .help("Analyzed moments · read-only")
    }

    @ViewBuilder
    private func railTick(_ tick: Tick, railWidth: CGFloat) -> some View {
        let center = railWidth * tick.position
        if tick.isActive {
            RoundedRectangle(cornerRadius: 6)
                .fill(tick.accent)
                .frame(width: 12, height: 22)
                .background(
                    RoundedRectangle(cornerRadius: 9)
                        .fill(tick.accent.opacity(0.22))
                        .frame(width: 18, height: 28)
                )
                .offset(x: min(max(center - 6, 0), railWidth - 12))
                .help(tick.tooltip)
        } else {
            Capsule()
                .fill(tick.isPassed ? tick.accent.opacity(0.4) : Color.white.opacity(0.22))
                .frame(width: 2, height: tick.isPassed ? 12 : 10)
                .offset(x: min(max(center - 1, 0), railWidth - 2), y: tick.isPassed ? 5 : 6)
                .help(tick.tooltip)
        }
    }
}

/// The 1b insight card: accent spine on the leading edge instead of a stroke,
/// one demoted metadata line, and trailing `Open m:ss` + dismiss chips.
struct RailDiscussionInsightCard: View {
    let event: DiscussionEvent
    let onOpen: () -> Void
    let onDismiss: () -> Void
    let onHover: (Bool) -> Void
    var onPreferredHeightChange: (CGFloat) -> Void = { _ in }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var style: DiscussionInsightStyle { .init(type: event.type, confidence: event.confidence) }

    var body: some View {
        HStack(spacing: 0) {
            style.accent.frame(width: 3)

            HStack(alignment: .top, spacing: 9) {
                Image(systemName: style.symbol)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(style.accent)
                    .padding(.top, 1)
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 3) {
                    metadata

                    Text(event.title)
                        .font(.callout.weight(.semibold))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .help(event.title)

                    Text(event.summary)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                        .help(event.summary)
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)

                VStack(alignment: .trailing, spacing: 6) {
                    Text(discussionTime(event.triggerTime))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)

                    Spacer(minLength: 0)

                    HStack(spacing: 6) {
                        Button("Open \(discussionTime(event.startTime))", action: onOpen)
                            .buttonStyle(.plain)
                            .font(.caption2.weight(.medium))
                            .padding(.vertical, 3)
                            .padding(.horizontal, 8)
                            .background(Color.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
                            .help("Open on YouTube at \(discussionTime(event.startTime))")

                        Button(action: onDismiss) {
                            Image(systemName: "xmark")
                                .font(.system(size: 8, weight: .bold))
                                .foregroundStyle(Color.white.opacity(0.5))
                                .frame(width: 20, height: 20)
                        }
                        .buttonStyle(.plain)
                        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 6))
                        .keyboardShortcut(.cancelAction)
                        .accessibilityLabel("Dismiss insight")
                    }
                }
                .frame(maxHeight: .infinity)
            }
            .padding(.vertical, 9)
            .padding(.horizontal, 11)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(style.accent.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .contentShape(Rectangle())
        .onHover(perform: onHover)
        .onAppear { onPreferredHeightChange(preferredCardHeight) }
        .onChange(of: event.id) { _, _ in onPreferredHeightChange(preferredCardHeight) }
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
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(style.label.uppercased())
                .font(.caption2.weight(.bold))
                .tracking(0.6)
                .foregroundStyle(style.accent)
            Text(metadataDetail)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }

    private var metadataDetail: String {
        var parts: [String] = []
        if let speaker = event.speaker, !speaker.isEmpty { parts.append(speaker) }
        parts.append(style.confidenceLabel.lowercased())
        if event.confidence < 0.6 { parts.append("review context") }
        return parts.joined(separator: " · ")
    }

    private var preferredCardHeight: CGFloat {
        // Text width at the 640-point notch after the outer inset, spine, card
        // padding, symbol column, and trailing chip column are removed.
        let textWidth: CGFloat = 430
        let titleHeight = min(
            measuredHeight(
                event.title,
                font: .systemFont(ofSize: 12, weight: .semibold),
                width: textWidth
            ),
            32
        )
        let summaryHeight = min(
            measuredHeight(event.summary, font: .systemFont(ofSize: 10), width: textWidth),
            40
        )
        // Metadata row, two 3 pt gaps, and 9 pt vertical padding are fixed.
        return ceil(37 + titleHeight + summaryHeight)
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

func discussionTime(_ seconds: Double) -> String {
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

#Preview("Insight rail") {
    VStack(spacing: 9) {
        DiscussionInsightRailView(
            events: DiscussionEvent.railPreviewEvents,
            activeEventID: "rail-4",
            currentTime: 342.8,
            duration: 1_204
        )
        RailDiscussionInsightCard(
            event: DiscussionEvent.railPreviewEvents[4],
            onOpen: {},
            onDismiss: {},
            onHover: { _ in }
        )
        .frame(height: 75)
    }
    .padding(.horizontal, 32)
    .padding(.vertical, 14)
    .frame(width: 640)
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
    /// Eleven analyzed moments spread across a 20:04 video, mirroring the
    /// handoff's rail fixture; the fifth is active at the 5:42 playhead.
    static let railPreviewEvents: [DiscussionEvent] = {
        let moments: [(time: Double, type: String)] = [
            (72, "unsupported_claim"),
            (132, "contradiction"),
            (229, "missing_premise"),
            (289, "unsupported_claim"),
            (342.8, "unsupported_claim"),
            (409, "evasion"),
            (445, "contradiction"),
            (626, "strawman"),
            (758, "missing_premise"),
            (794, "unsupported_claim"),
            (975, "evasion"),
        ]
        return moments.enumerated().map { index, moment in
            DiscussionEvent(
                id: "rail-\(index)",
                startTime: max(0, moment.time - 4),
                triggerTime: moment.time,
                endTime: moment.time + 6,
                speaker: "Speaker A",
                type: moment.type,
                title: "The numerical claim is presented without a source",
                summary: "A percentage is given with no evidence or time period attached.",
                confidence: 0.91,
                evidence: "The rate rose by forty percent."
            )
        }
    }()

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
