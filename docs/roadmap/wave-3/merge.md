# Wave 3 Integration Playbook

- **Integration branch:** `integrate/wave-3`
- **Base tag:** `wave-3-start`
- **Completion tag:** `wave-3-complete`

## Merge order

1. **W3-T1** establishes the real analysis API.
2. **W3-T4** connects submission/loading to that API and the existing timeline cache.
3. **W3-T2** connects real browser playback to the timeline input.
4. **W3-T3** connects timeline output to notch presentation.
5. Add one integration commit wiring session state across the three seams.

## Integration procedure

- Branch from `wave-3-start`, equal to `wave-2-complete`.
- Bring up the API and validate URL-to-timeline before native messaging changes.
- Validate native playback-to-engine before card wiring.
- Keep W3-T2 connection failures separate from W3-T1 analysis failures in app state.
- Resolve shared Swift coordinator conflicts with W3-T3 and W3-T4 owners together.
- Create `docs/integration/wave-3.md` from the merge-log template.

## Seam checks

Run these independently before the full flow:

1. URL -> API -> cached analysis -> ready session.
2. YouTube player -> extension -> native host -> Swift playback state.
3. Fixture timeline event -> notch card.
4. Current browser video ID -> analysis session activation/mismatch suppression.

Then run one full known-video trigger.

## Exit checklist

- [ ] Cold and warm analysis paths work.
- [ ] Offline valid-cache path works.
- [ ] Chrome playback arrives within 500 ms.
- [ ] Seek and video-change behavior is correct.
- [ ] Fixture and real event cards render correctly.
- [ ] Existing notch activities still work.
- [ ] `git diff --check` passes.
- [ ] Integration log records permissions, commands, and known issues.

Merge to `main` and create `wave-3-complete` only when every checked item is true.
