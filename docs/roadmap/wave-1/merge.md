# Wave 1 Integration Playbook

- **Integration branch:** `integrate/wave-1`
- **Base tag:** `wave-1-start`
- **Completion tag:** `wave-1-complete`

## Merge order

1. **W1-T1** establishes the buildable baseline and owns project-file conflict resolution.
2. **W1-T2** installs canonical contracts and fixtures.
3. **W1-T4** points mocks and validation commands at those canonical fixtures.
4. **W1-T3** lands design artifacts and confirms its required fields exist in the contract.
5. Add one integration commit for path, command, or naming adaptations.

## Integration procedure

- Create the integration branch from `wave-1-start`.
- Merge each reviewed package without squashing away its handoff context unless the team has agreed to squash all packages.
- Run `git diff --check` after every merge.
- Resolve duplicated fixture files by retaining only W1-T2's canonical copy.
- Have the macOS owner inspect every `.xcodeproj` conflict.
- Have all four contributors review the final contract diff.
- Create `docs/integration/wave-1.md` using the [merge-log template](../merge-strategy.md#merge-log).

## Seam checks

- The mock API serves the canonical valid analysis fixture.
- The fixture-validation command passes and rejects at least one invalid fixture.
- Setup docs reference actual schemes, paths, ports, and environment names.
- UX-required fields exist in the schema and fixture.
- No secret or personal signing value exists in tracked files.

## Exit checklist

- [ ] Clean Xcode build passes.
- [ ] Mock backend starts and responds.
- [ ] Contract validation passes.
- [ ] Extension skeleton loads unpacked.
- [ ] UX state machine is approved by all owners.
- [ ] `git diff --check` passes.
- [ ] Integration log records commands and known issues.

Merge to `main` and create `wave-1-complete` only when every checked item is true.
