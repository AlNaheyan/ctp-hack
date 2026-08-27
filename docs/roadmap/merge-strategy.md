# Four-Person Integration Strategy

Use this process between every wave. The wave-specific merge playbooks define the exact order and checks.

## Roles

Choose roles at the start of each wave; rotate them if useful.

| Role | Responsibility |
| --- | --- |
| Contributor A–D | Own one work package, its tests, and its handoff notes |
| Wave integrator | Creates the integration branch, merges packages, and resolves only seam conflicts |
| Reviewer | Reviews contracts and behavior, not just syntax; may also be a contributor |
| Demo owner | Confirms integrated behavior against the current demo fixture |

The integrator should not silently redesign another contributor's package during merge. Send behavioral changes back to the package owner or record the decision in the merge log.

## Branch model

For wave `N`:

```text
main
 └── integrate/wave-N
      ├── work/wN-t1-short-name
      ├── work/wN-t2-short-name
      ├── work/wN-t3-short-name
      └── work/wN-t4-short-name
```

1. Tag the starting point as `wave-N-start`.
2. Create every work branch from that exact tag, not from another person's branch.
3. Keep package commits reviewable, but do not merge unfinished scaffolding into the integration branch.
4. Create `integrate/wave-N` from the same tag.
5. Merge packages in the order listed by the wave playbook.
6. Fix cross-package adaptation in a separate commit named `integrate: connect wave N components`.
7. After the exit checklist passes, merge the integration branch to `main` and tag `wave-N-complete`.

## Required handoff from every contributor

Each pull request must state:

- Contract or fixture version used.
- Files and directories owned or changed.
- Commands run and their results.
- Manual verification performed.
- Known limitations, follow-ups, and feature flags.
- Environment variables, permissions, or install steps introduced.
- Exact output another package should consume and exact input this package expects.

## Conflict policy

- Contract conflicts are resolved by W1-T2's owner or the current contract owner.
- Product behavior conflicts are resolved using W1-T3's state machine.
- Build/project-file conflicts are resolved by the macOS/platform owner.
- Never accept an entire side of a project-file conflict without checking file references and build phases.
- Do not weaken schema validation to make integration pass. Add an adapter or correct the producer.
- Do not combine infrastructure secrets into app or extension code.

## Common integration checks

Run these after each merge, not only at the end:

```bash
git diff --check
git status --short
```

Also run the current backend tests, extension tests, Xcode tests/build, fixture validation, and the wave's manual smoke test. If a command is not available yet, the integration log must explain why and identify the package that will add it.

## Merge log

Create `docs/integration/wave-N.md` on the integration branch from this template:

```markdown
# Wave N Integration Log

- Base tag:
- Integration branch:
- Integrator:
- Included PRs/commits:
- Contract version:
- Merge order:
- Adapter changes:
- Automated checks:
- Manual checks:
- Known issues:
- Exit decision: PASS / FAIL
```

The log is an integration artifact, not optional meeting notes.
