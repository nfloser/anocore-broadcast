# Real CS2 observer + OBS acceptance protocol

**Status: NOT YET EXECUTED.** This is an operator procedure and evidence template, not test results. It is required for [partial GSI semantics #62](https://github.com/nfloser/anocore-broadcast/issues/62) and [Windows release readiness #41](https://github.com/nfloser/anocore-broadcast/issues/41). The synthetic HTTP integration tests and Windows CI packaged startup smoke do **not** certify any real CS2/GOTV feed.

## Safety and prerequisites

- Use an authorized CS2 spectator/GOTV session and an operator-controlled Windows x64 PC with CS2 and OBS. The local observer and AnoCore Broadcast **must be on the same PC**; ports 3008 (GSI) and 3009 (OBS source) must be available.
- Obtain the **unsigned test artifact** from a completed successful **main-branch run** of the [Windows desktop preview workflow](https://github.com/nfloser/anocore-broadcast/actions/workflows/windows-desktop.yml) for the exact merged commit under test. Download its `anocore-broadcast-windows-preview` artifact and compare the executable's PowerShell `Get-FileHash -Algorithm SHA256` output against `SHA256SUMS.txt`. If the seven-day artifact expires, manually dispatch the workflow on `main`; do not use an unverified PR build. It is not a signed production installer. Record run link, merged commit SHA, Windows and CS2 build versions, OBS version, observer mode and local time of the session.
- Do not share **raw GSI traffic**, `gamestate_integration_anocore.cfg`, `observer-credential.json`, auth tokens, Steam IDs, player/chat names, console dumps or screenshots with identifying data. Do not upload GSI captures to public issues. If a permissioned sample is truly necessary, collect and sanitize under an agreed private review process; review it manually before transfer. The **Copy safe diagnostics** report is the only intended shareable diagnostic output; examine it before sharing.
- Establish ground truth by observing the **same CS2 spectator/GOTV view** used to feed GSI. A green connection indicator is not evidence of correct match details or synchronized OBS video.

## Start the local observer and OBS

1. With ports free, launch the packaged portable Windows EXE. Confirm its initial HUD explicitly says **DEMO · SYNTHETIC DATA**; the synthetic radar must carry its warning. No Node/npm/PowerShell should be required for the packaged application.
2. In **Broadcast → Operator Controls** choose **Start Live Observer**. It should show **LIVE · WAITING FOR CS2** and the HUD must not show synthetic scores, radar markers or a DEMO watermark on real live data.
3. For first setup, select **Export CS2 GSI CFG** and save `gamestate_integration_anocore.cfg` inside the actual CS2 `game/csgo/cfg` folder. **Do not include its contents in evidence.** Restart CS2 after installing. For later launches with the same Windows user and saved key, do not re-export the CFG.
4. Observe a match with CS2/GOTV and watch the Operator Controls status. **LIVE · RECEIVING GSI** confirms only authenticated traffic; check the separate HUD coverage warning. Copy **safe diagnostics** at the checkpoints below. Do not change the GSI key or enable external binding.
5. In OBS, add a **Browser Source** with URL `http://127.0.0.1:3009/`, width **1920**, height **1080**. Compare against the **same** spectator view, not another client with different delay. Note any observed video/graphics offset; no frame accuracy is assumed.

## Acceptance matrix — fill in observed results, never pre-mark pass

For each case note the spectator's **visual ground truth** and the OBS HUD's appearance, then check the corresponding diagnostic counts if available. Mark PASS only when actually observed; use FAIL or NOT RUN otherwise.

| Case | Action | What to check | Actual / PASS / FAIL / NOT RUN |
| --- | --- | --- | --- |
| A01 | Launch portable EXE, then switch Demo → Live | Startup without Node, clear DEMO labeling on live; unknown scores shown as unavailable while waiting | NOT RUN |
| A02 | Spectate freeze time | Real map, both side scores, round, reported GSI countdown, player availability; record fields missing from spectator vs HUD | NOT RUN |
| A03 | Observe normal live round and player death | Score, HP, active weapon, kills, and roster changes vs spectator; missing fields must not be fabricated | NOT RUN |
| A04 | Round ends and new round starts | Winning side, CT/T scores, round number and phases; no rollback to old score | NOT RUN |
| A05 | Halftime / side swap | Side assignment and identity vs spectator; document ambiguity; no synthetic or guessed values | NOT RUN |
| A06 | Overtime, if available | Score/round progression and team side labels vs spectator; do not infer from standard regulation-only rules | NOT RUN |
| A07 | Spectator reconnect, demo/GOTV seek or disconnect | Watch whether HUD hides old data and resumes without ghost players; record status/coverage | NOT RUN |
| A08 | Stop CS2 spectator / GSI sender | After stale timeout, HUD must be unavailable, not an old live scoreboard | NOT RUN |
| A09 | Resume authorized spectator | Updates recover; check map/round/scores and OBS Browser Source again | NOT RUN |
| A10 | Map change / next match | Old map, players and scores must not masquerade as the new match; document observed epoch semantics | NOT RUN |
| A11 | Switch Live → Demo → Live without restarting app | Demo clearly marked, fake radar only in Demo, real state never labeled synthetic; recheck saved key | NOT RUN |
| A12 | Close main window and launch EXE again | Local 3008/3009 ports released/reused, settings persisted, stored key reused; no leftover live score | NOT RUN |
| A13 | Observe OBS output while transitions occur | Compare graphics to actual spectator video timing and check mismatch duration; do not assume synchrony | NOT RUN |

Not every mode will be available in one match. Record **NOT RUN**, not PASS, for absent scenarios. Unverified halftime, map-change, stale recovery or GOTV synchronization remain release blockers when relevant.

## Privacy-safe diagnostic checkpoints

While **Live** is active, use **Operator Controls → Copy safe diagnostics** and paste only its allowlisted JSON into a private scratch file after visually verifying it has no unexpected values. Suggested checkpoints:

- D0: just after starting Live, before a real spectator sends data.
- D1: freeze time, after enough GSI messages have arrived.
- D2: mid-live round.
- D3: immediately after round end / map-phase change.
- D4: after an interruption or a reconnect.

Each report includes freshness, current public HUD field availability, counts for the last **64 accepted authenticated frames**, and adjacent presence/roster transition aggregates. Interpret `completeScoreboard` as **all core fields present in that individual GSI message**, not independently verified correctness. `longestIncompleteScoreboardStreak` counts messages, **not seconds**. `previously` and `added` counts indicate only top-level object presence, not whether the adapter should merge them. Compare D1–D4 **without combining counters across overlapping windows**; restarting Live resets the window. Never infer that an omitted field means unchanged or removed without real payload semantics evidence.

### Evidence record (copy per test session)

```text
Run: NOT RUN
CI artifact run URL:
Tested commit SHA:
Unsigned EXE SHA-256 verified: YES / NO / NOT RUN
Windows build:
CS2 build:
OBS version:
Spectator mode (authorized; no identity):
CS2-observed condition / phase:
OBS view matches observed map, scores, round and players: PASS / FAIL / NOT RUN
Operator status and coverage:
A01–A13 results with notes:
D0–D4 safe report checkpoints reviewed (no credentials or player identities):
Divergence: expected vs actual, reproducible steps, approximate observer/HUD delay:
Privacy check before sharing:
Tester / review approval (private, optional):
Decision: ACCEPTED / REJECTED / BLOCKED (never auto-mark accepted)
```

## Release/implementation decision

- **Do not automatically merge partial CS2 GSI payloads** based only on counters or synthetic test results. Real observer capture semantics (including `previously`, `added`, omission vs empty, death/disconnect, halftime and match changes) must be established first under #62.
- **Do not close #62** until observed real CS2/GOTV field behavior is documented and tested, and relevant discrepancies are reproduced and fixed. **Do not close #41 or publish a production release** until clean Windows behavior, OBS acceptance, security/privacy review and actual viewer/video alignment are assessed.
- Attach only privacy-reviewed summaries and redacted, identity-free observations to the issue. If the evidence suggests missing fields have a different meaning, open a separate regression issue with sanitized steps and implement the fix on its own branch.
