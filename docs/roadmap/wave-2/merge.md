# Wave 2 Integration Playbook

- **Integration branch:** `integrate/wave-2`
- **Base tag:** `wave-2-start`
- **Completion tag:** `wave-2-complete`

## Merge order

1. **W2-T1** adds normalized transcript production.
2. **W2-T2** adds analysis consuming the canonical transcript contract.
3. **W2-T3** adds browser playback production.
4. **W2-T4** adds Swift consumption of analysis and playback fixtures.
5. Add one adapter-only commit to resolve type/path differences.

The packages remain independently testable; this wave does not add real API or native-message integration.

## Integration procedure

- Branch from `wave-2-start`, which must equal `wave-1-complete`.
- Confirm every package used the same schema version before merging.
- Retain provider-neutral interfaces; do not make transcript code call Gemini directly.
- Retain the extension mock transport; do not prematurely bind it to native messaging.
- Resolve generated/type-name collisions by changing local adapters, not shared schemas.
- Create `docs/integration/wave-2.md` from the merge-log template.

## Seam checks

- Feed W2-T1's normalized transcript fixture directly into W2-T2.
- Feed W2-T3's recorded playback fixture directly into W2-T4's decoder.
- Run Swift tests with the canonical analysis fixture.
- Confirm all live network/model tests remain opt-in.
- Confirm component tests pass with backend, Chrome, and Mac processes stopped.

## Exit checklist

- [ ] Backend URL/transcript tests pass.
- [ ] Analyzer stubbed tests pass.
- [ ] Extension observer tests/checklist pass.
- [ ] Swift timeline/cache tests pass.
- [ ] Both producer-consumer fixture seam checks pass.
- [ ] `git diff --check` passes.
- [ ] Integration log records commands and known issues.

Merge to `main` and create `wave-2-complete` only when every checked item is true.
