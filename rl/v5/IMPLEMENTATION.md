# v5 implementation boundary

The v5 implementation is intentionally isolated under `rl/v5/`. It uses a
JSONL worker that imports the existing TypeScript rule functions but owns a
fresh `GameState` for every branch. `view()` removes `tokens`, host tokens and
the engine RNG. `simulate` injects an independent seed, so neither search nor
the policy can read the real combat stream. Real `apply` is transactional.

The initial release is two-player `standard`; simultaneous, annihilation and
royale require separate action/settlement heads and are rejected by the worker.
No v5 command is started by importing modules. The setup command writes only a
manifest/config under ignored `rl/test-output/v5`; `--execute` is an explicit
later choice.
