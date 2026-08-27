# Wave 4 Release Integration Playbook

- **Integration branch:** `integrate/wave-4`
- **Base tag:** `wave-4-start`
- **Completion tag:** `hackathon-demo`

## Merge order

1. **W4-T2** establishes the regression baseline and smoke checklist.
2. **W4-T1** lands measured adapter fixes with the regression suite protecting behavior.
3. **W4-T3** packages the resulting stable build.
4. **W4-T4** pins demo instructions to the packaged version and measured timings.
5. Add one release-integration commit containing only version/path/runbook reconciliation.

## Integration procedure

- Branch from `wave-4-start`, equal to `wave-3-complete`.
- Run the regression command after every package merge.
- Require W4-T2 owner review for any test expectation changed by W4-T1.
- Build packaging from the integrated commit, not a contributor branch.
- Record the exact commit and artifact version used by W4-T4's script.
- Create `docs/integration/wave-4.md` from the merge-log template.

## Release rehearsal

1. Use a clean macOS account or teammate machine.
2. Follow only W4-T3's install guide.
3. Run W4-T2's smoke checklist.
4. Restart Chrome and the Mac app.
5. Perform W4-T4's live script twice.
6. Disable the network/provider and perform the disclosed fallback once.
7. Follow uninstall steps and confirm registration cleanup.

## Exit checklist

- [ ] All non-UI tests pass from one command.
- [ ] Ten-minute smoke checklist passes.
- [ ] Clean installation and uninstallation pass.
- [ ] Warm readiness and card latency meet targets.
- [ ] Known-video script passes twice after restarts.
- [ ] Contract-faithful fallback passes and is disclosed.
- [ ] License, attribution, privacy, and limitations are present.
- [ ] `git diff --check` passes.
- [ ] Integration log records the shipped commit and artifact version.

Tag the verified commit `hackathon-demo`. Do not modify the demo build after rehearsal without rerunning this checklist.
