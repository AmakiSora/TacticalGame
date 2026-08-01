# Standard mode

Use only when `game.config.mode === "standard"`.  
If the game is `annihilation`, stop and read `annihilation.md` instead — do not apply this file.

## Turn checklist

Every action on your turn, inspect:

- Your units **with** `config.units` + each instance's `moveRange` / `attackRange` / `canCapture` / `healPower` / cost (never assume stock stats)
- Supplies, `turn.actionsUsed` vs `actionsPerTurn`
- Control points (owners and kinds if typed)
- **All living opponents' headquarters** HP and your own HQ
- Live `adjudication` (`scores`, `weights`, `leaders`, `margin`) including **`actionScore`** and `weights.effectiveActions`
- Legal targets: enemy units **and** living enemy HQs

## Rules (standard only)

- Runtime **creates headquarters** (`store` builds HQ only when `mode === "standard"`).
- **Deploy origins:** your HQ **or** an owned control point, into an adjacent empty plain cell.
  - `fromId` = your HQ entity id **or** owned CP id.
- **Elimination:** destroying a player's HQ eliminates them — units removed, their CPs go neutral, resources freeze; match continues for remaining players.
- **Adjudication** uses the shared six-term formula in `SKILL.md`: HQ damage, own HQ HP, CPs, army value, supplies, **and `actionScore`**. Enemy HQ damage accumulates across opponents in multiplayer.
- `actionScore = actionMerit × effectiveActions` (standard default **2** per merit point unless the map sets `weights.effectiveActions`). Merit comes from deploy / demolish / capture / damage / heal — **not** from pure moves.
- Read `adjudication.scores.<you>.actionScore` and rival breakdowns; do not recompute.
- Movement cannot path through living HQs.
- Prefer HQ pressure when board state and non-zero HQ weights reward it.

## Decision order

Unless the user asks for a different style:

1. **Attack the weakest nearby enemy HQ** any unit can hit. Prefer nearest low-HP living HQ among opponents.
2. **Attack killable / low-HP enemy units**; prefer support, ranger, and capturers. Ignore eliminated seats.
3. **Heal** the most damaged friendly with support.
4. **Demolish** an adjacent blocker with heavy when it opens CPs, deploy space, attack lanes, or a path to an enemy HQ.
5. **Deploy** before ordinary moves when supplies + AP remain — especially high supplies, army not ahead of the strongest living rival, ≥2 owned CPs, or late game.
   - Comeback supplies: rebuild or contest income CPs; grants may stop when the gap closes.
   - `fromId` must be HQ id or owned CP id.
6. **Early:** move infantry/scouts to neutral or enemy CPs. On typed maps: `supply` early, `forward_base` for sustained pressure, `repair` when wounded units can hold nearby.
7. **Late:** move scouts/rangers/infantry onto best enemy **HQ** attack hexes.
8. **Near adjudication:** read `adjudication.scores` / `weights` / `leaders` / `margin`. Prioritize non-zero levers: HQ damage, CPs, valuable army survival, **productive action merit** (attacks, heals, deploys, captures, demolish), and convert excess supplies into units when AP/deploy hexes exist. Do **not** end the round on empty shuffles or supply hoarding — they add no `actionScore`. HQ damage already dealt to now-eliminated rivals still counts.
9. **No useful action** → `/end-turn`.

## Pre-action checks

- Stats from **this** map's `config.units` / unit instance — not memory
- Unit can move/act as required; target within **that unit's** `attackRange` or path within `moveRange`
- Capture only if `canCapture`; heal only with support → friendly unit; demolish only with heavy → adjacent empty blocker
- Destination in `game.cells` and otherwise legal
- Deploy `fromId` is **your living HQ or an owned CP**; cost from `config.units[type]`
- AP allows a new activation when needed
