# Engineering guidelines

## Work cycle
Inspect current issues, PRs, architecture, code, tests, and CI before changing anything. For substantive changes: issue -> branch -> failing regression test (when feasible) -> implementation -> documentation -> PR -> CI -> independent review -> fixes -> merge. Do not push feature work directly to main.

## Design constraints
- This is an independent product; optional server integrations must never be required for core operations.
- Separate event ingestion, source-of-truth state, observer/broadcast synchronization, rendering, and operator controls.
- Fail closed for authorization and avoid broadcasting privileged match information to players.
- No secrets in logs, UI sources, artifacts, or repository.
- Assume events may be missing, delayed, duplicated, reordered or malformed. Provide measurable recovery behavior.
- Use protocol versions, explicit compatibility checks, immutable inputs and deterministic state transitions.
- Never invent live values when input is stale; expose source freshness and degradation states.
- Test important edge cases, including overtime, halftime, reconnect, observer delay, and stream recovery.
- No placeholder implementations presented as completed features.
- Do not remove an existing capability or test merely to make a change pass.
- Keep commits focused and PR descriptions factual. Use clear, natural-language messages.

## Verification
Run available formatting/lint/type/test/build/security checks. Review acceptance criteria and operational behavior separately from green tests. Record the exact checks actually run and any limitations.

## Documentation and releases
Update README, architecture, protocol examples and operator instructions alongside changes. Releases only for meaningful validated milestones. No unverified claims of broadcast reliability.
