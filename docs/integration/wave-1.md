# Wave 1 Integration Log

- **Base tag:** `wave-1-start` at `9c0e507`
- **Integration branch:** `integrate/wave-1`
- **Integrator:** Codex, on behalf of the hackathon team
- **Contract version:** 1
- **Exit decision:** **INCOMPLETE — keep on the integration branch**

## Included work

| Package | Source | Integration commit | Notes |
| --- | --- | --- | --- |
| W1-T1 fork baseline | `origin/work/w1-t1-fork-baseline` at `04e525f` | merge `254163c` | Merged first per playbook |
| W1-T2 contracts | `origin/work/w1-t2-contracts-fixtures` at `7a604e3` | merge `09abc73` | Canonical contracts and fixture manifest |
| W1-T4 developer stack | `origin/work/w1-t4-developer-stack` feature commit `f7ba926` | cherry-pick `facdb50` | Cherry-picked to exclude an accidental merge parent containing the full upstream history |
| Cross-package adapters | integration branch | `a59b13d` | Reconciled fixture discovery, validation, mock errors, tests, and docs |
| W1-T3 UX state machine | not present on origin | not merged | Required before the Wave 1 exit gate can pass |

## Merge order

1. W1-T1 baseline.
2. W1-T2 contracts and fixtures.
3. W1-T4 feature patch without its polluted ancestry.
4. Cross-package adapter commit.
5. W1-T3 remains pending.

## Adapter decisions

- `fixtures/manifest.json` is the only fixture registry.
- The mock backend resolves analysis fixtures from manifest entries and payload `videoId`, not filenames.
- T4's provisional duplicate analysis/playback fixture tree and structural validator were removed.
- `npm run validate:fixtures` and the smoke suite call W1-T2's canonical validator.
- Backend error responses use W1-T2's closed v1 error-code enum. Mock-specific conditions map to canonical codes.
- T4 was cherry-picked because merging its branch would have restored 1,265 upstream commits that the fork intentionally removed.

## Automated checks

| Check | Result |
| --- | --- |
| `npm test` | PASS — 50/50 tests |
| `npm run lint` | PASS — 23 JavaScript files, 15 JSON files, 244 files scanned for credentials |
| `npm run validate:fixtures` | PASS — 11/11 valid and expected-invalid fixtures |
| `npm run smoke` | PASS — 11/11 checks, including real loopback HTTP round trips |
| `git diff --check` | PASS |
| macOS Debug `xcodebuild`, unsigned | PASS — app and embedded helper built |
| Upstream-history containment | PASS — `8631461` is not an ancestor of the integration branch |

The macOS build emitted existing/non-blocking warnings, including an out-of-date CoreSimulator notice, Swift concurrency warnings, and the MediaRemoteAdapter macOS 15-versus-deployment-target-14 warning. None failed the build.

## Manual checks

- [ ] Load `extension/` unpacked in Chrome with no errors.
- [ ] Confirm a YouTube page produces a playback message in the service-worker console.
- [ ] Launch the built app and perform the notch open/close/HUD visual smoke check.
- [ ] Review and approve the W1-T3 UX state machine after its branch is supplied.

## Exit checklist

- [x] Clean Xcode build passes.
- [x] Mock backend starts and responds.
- [x] Contract validation passes.
- [ ] Extension skeleton is manually loaded unpacked.
- [ ] UX state machine is merged and approved by all owners.
- [x] `git diff --check` passes.
- [x] Integration log records commands and known issues.

Do not merge this branch to `main` or create `wave-1-complete` until W1-T3 and the manual checks are complete. Add W1-T3 after `a59b13d`, rerun every check above, update this log to `PASS`, then follow the Wave 1 playbook.
