//
//  ContentView.swift
//  boringNotch
//
//  Focused discussion-analyzer notch surface.
//

import Defaults
import SwiftUI

@MainActor
struct ContentView: View {
    @EnvironmentObject private var vm: BoringViewModel
    @StateObject private var discussion = DiscussionSessionModel.shared
    @StateObject private var presentation = DiscussionPresentationModel.shared
    @ObservedObject private var coordinator = BoringViewCoordinator.shared
    @State private var closeTask: Task<Void, Never>?
    @State private var hoverTask: Task<Void, Never>?
    @State private var isHovering = false

    private let contentHorizontalInset: CGFloat = 32

    private let interactionSpring = Animation.interactiveSpring(
        response: 0.54,
        dampingFraction: 0.8,
        blendDuration: 0
    )
    private let closeSpring = Animation.spring(
        response: 0.62,
        dampingFraction: 1.0,
        blendDuration: 0
    )

    private var notchShape: NotchShape {
        NotchShape(
            topCornerRadius: vm.notchState == .open ? 19 : 6,
            bottomCornerRadius: vm.notchState == .open ? 24 : 14
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            Group {
                if vm.notchState == .open {
                    VStack(spacing: 0) {
                        Color.clear
                            .frame(height: max(24, vm.effectiveClosedNotchHeight))

                        NotchHomeView(
                            model: discussion,
                            presentation: presentation,
                            onInsightHeightChange: resizeForInsight
                        )
                            .padding(.top, 8)
                            .padding(.horizontal, contentHorizontalInset)
                    }
                } else {
                    if let event = presentation.activeEvent, !higherPriorityActivityVisible {
                        CompactDiscussionInsightCard(
                            event: event,
                            onDismiss: presentation.dismiss
                        )
                    } else {
                        Color.clear
                            .accessibilityLabel("Discussion Notch")
                    }
                }
            }
            .frame(width: vm.notchSize.width, height: vm.notchSize.height, alignment: .top)
            .background(.black)
            .clipShape(notchShape)
            .shadow(
                color: vm.notchState == .open || isHovering ? .black.opacity(0.7) : .clear,
                radius: 6
            )
            .contentShape(Rectangle())
            .onTapGesture(perform: open)
            .onHover(perform: handleHover)
            .animation(
                vm.notchState == .open
                    ? .spring(response: 0.56, dampingFraction: 0.8, blendDuration: 0)
                    : closeSpring,
                value: vm.notchState
            )
        }
        .padding(.bottom, 8)
        .frame(maxWidth: windowSize.width, maxHeight: windowSize.height, alignment: .top)
        .preferredColorScheme(.dark)
        .onAppear {
            presentation.setExpanded(vm.notchState == .open)
            presentation.setPlaybackPaused(discussion.playback.paused)
            presentation.setInterrupted(higherPriorityActivityVisible)
        }
        .onChange(of: vm.notchState) { _, state in
            presentation.setExpanded(state == .open)
        }
        .onChange(of: discussion.playback.paused) { _, paused in
            presentation.setPlaybackPaused(paused)
        }
        .onChange(of: higherPriorityActivityVisible) { _, interrupted in
            presentation.setInterrupted(interrupted)
        }
        .onChange(of: presentation.activeEvent?.id) { _, insightID in
            if insightID == nil, vm.notchState == .open {
                vm.resizeOpenNotch(to: openNotchSize.height)
            }
            if insightID == nil, !isHovering {
                scheduleClose()
            }
        }
    }

    private func open() {
        closeTask?.cancel()
        guard vm.notchState == .closed else { return }
        withAnimation(interactionSpring) { vm.open() }
    }

    private func resizeForInsight(_ cardHeight: CGFloat) {
        guard presentation.activeEvent != nil else { return }
        // Closed-notch clearance, input, playback bar, and vertical spacing sit
        // above the card. The visible notch grows downward; the host window has
        // capacity up to maximumOpenNotchHeight.
        let chromeHeight = max(24, vm.effectiveClosedNotchHeight) + 86
        withAnimation(.easeInOut(duration: 0.2)) {
            vm.resizeOpenNotch(to: chromeHeight + cardHeight)
        }
    }

    private func handleHover(_ hovering: Bool) {
        isHovering = hovering
        closeTask?.cancel()
        hoverTask?.cancel()

        if hovering {
            guard vm.notchState == .closed, Defaults[.openNotchOnHover] else { return }
            hoverTask = Task { @MainActor in
                try? await Task.sleep(for: .seconds(Defaults[.minimumHoverDuration]))
                guard !Task.isCancelled, isHovering, vm.notchState == .closed else { return }
                open()
            }
            return
        }

        scheduleClose()
    }

    private func scheduleClose() {
        closeTask?.cancel()
        closeTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(100))
            guard !Task.isCancelled, !isHovering else { return }
            withAnimation(closeSpring) { vm.close() }
        }
    }

    private var higherPriorityActivityVisible: Bool {
        let systemHUDVisible = coordinator.sneakPeek.show
            && coordinator.sneakPeek.type != .music
            && coordinator.sneakPeek.type != .battery
        return systemHUDVisible || vm.generalDropTargeting
    }
}

#Preview {
    let vm = BoringViewModel()
    vm.open()
    return ContentView()
        .environmentObject(vm)
        .frame(width: windowSize.width, height: windowSize.height)
}
