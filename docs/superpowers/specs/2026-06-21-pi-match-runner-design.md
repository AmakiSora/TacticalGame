# Pi Match Runner Design

## Summary

Add a non-interactive match runner for Hex V2 that repeatedly calls the correct Pi Coding Agent when that player's turn is active. The runner lives under `script/`, not `skill/`, because it is an orchestration utility rather than the reusable local AI skill.

The selected integration mode is direct Pi control with persistent per-player Pi sessions. Each player gets one stable Pi session for the match, so the first invocation sends the full game id, player token, API base URL, and rules context, while later turns only need a short message such as `到你了`. The runner does not decide moves. It only creates or reconnects games, detects whose turn it is, invokes the matching Pi session, and verifies that turn ownership changes or the game ends.

## User Interface

Create `script/pi-match-runner.mjs` with these supported flows:

- New match: create player A, join player B, then run both sides.
- Existing match: accept `--game`, `--a-token`, and `--b-token` to resume.
- Player identity: `--a-name`, `--b-name`, `--map`, and `--url`.
- Pi selection: either shorthand model flags (`--a-model`, `--b-model`, optional `--a-provider`, `--b-provider`) or full command overrides (`--a-pi`, `--b-pi`).
- Session control: `--session-dir` for Pi session storage and optional `--a-session-id` / `--b-session-id` overrides.
- Safety limits: `--max-rounds`, `--max-calls-per-turn`, `--delay-ms`, and `--timeout-ms`.

Default command construction uses `pi -p --session-id <stable-id>` with `--session-dir`, `--model`, or `--provider` when supplied. Full command overrides still receive the generated session flags and append the generated message as the final argument.

Stable session ids are deterministic and restart-safe:

- Player A default: `hexv2-{gameId}-player_a`
- Player B default: `hexv2-{gameId}-player_b`

Use the full game id in the default id, not a random UUID, so restarting the runner can resume the same Pi history. `--a-session-id` and `--b-session-id` are explicit escape hatches for manually chosen sessions.

## Behavior

- Poll `GET /api/games/:id` with the correct player token until `winner` exists or `phase === "game_over"`.
- If `phase !== "waiting_command"`, wait and poll again.
- If `turn.currentOwner === "player_a"`, invoke player A's Pi command; if it is `"player_b"`, invoke player B's Pi command.
- On a player's first invocation in a match, send the full context prompt. On later invocations for that same player session, send only `到你了`.
- After Pi exits, fetch state again. If the same player still owns the turn and the game is not over, call the same Pi session again with `继续`.
- Stop with an error if one player exceeds `--max-calls-per-turn` without ending the turn.
- Log each Pi invocation to `records/pi-runs/<gameId>/`, including prompt, stdout, stderr, exit code, and before/after turn metadata.

## Prompt Contract

The first message sent to each player's persistent Pi session includes:

- API base URL, game id, current player id, and that player's token.
- The REST endpoints and the requirement to use `X-Player-Token`.
- A concise Hex V2 rule reminder: axial `q/r`, five action activations per turn, deploy/move/attack/heal/end-turn endpoints, and no V1 build/produce/sell commands.
- A hard instruction that the agent must finish by calling `/end-turn` unless it wins before then.
- The instruction that future messages in this same session will be short triggers: `到你了` means play the current full turn, and `继续` means continue an interrupted or incomplete current turn.

Later messages are deliberately short so each model can rely on its own session memory instead of receiving the full rule prompt every turn.

## Error Handling

- Treat non-zero Pi exit codes as retryable within the per-turn call limit.
- Treat malformed or failed HTTP responses from the game server as runner errors with clear diagnostics.
- Do not continue without both player tokens.
- Do not share a Pi session between players; each side must have independent memory and model settings.
- Preserve existing untracked record files and never clean `records/`.

## Test Plan

- Unit-test argument parsing and Pi command construction.
- Unit-test deterministic per-player `--session-id` generation as `hexv2-{gameId}-{player}` and explicit overrides.
- Unit-test turn-owner-to-command selection.
- Unit-test retry behavior when Pi exits but turn ownership does not change.
- Unit-test stop behavior after `--max-calls-per-turn`.
- Smoke-test against the local server with stub Pi commands that call `/end-turn`.

## References

- Pi non-interactive mode: `pi -p` / `--print`, documented at https://pi.dev/docs/latest/usage.
- Pi CLI output modes and command options, documented at https://pi.dev/docs/latest/usage and available locally via `pi --help`.
- Hex V2 REST contract and turn-loop requirements in this repository's `README.md` and `skill/SKILL.md`.
