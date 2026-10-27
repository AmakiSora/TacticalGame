# Standard mode

Use only when `game.config.mode === "standard"`.  
If the game is `annihilation`, stop and read `annihilation.md` instead — do not apply this file.

Turn order is settled at start: read `turnOrder` from the opening `game_start` event (or `game.turn`) instead of assuming join order — the host may reorder lobby seats, which reorders turns. Seat ids (`player_a`…) and tokens never change, only the order.

## Turn checklist

Every action on your turn, inspect:

- Your units **with** `config.units` + each instance's `moveRange` / `attackRange` / `canCapture` / `healPower` / cost (never assume stock stats)
- Supplies, `turn.actionsUsed` vs `actionsPerTurn`
- Each unit's `hasMoved` / `hasActed` / `actionSpent` flags — an already-activated unit can still take its free follow-up action
- Control points (owners and kinds)
- **All living opponents' headquarters** HP and your own HQ
- Live `adjudication` (`scores`, `weights`, `leaders`, `margin`) including **`killValue` / `controlHold`** and `weights.killValue` / `weights.controlPointFlowRatio`
- Legal targets: enemy units **and** living enemy HQs

## Rules (standard only)

- Runtime **creates headquarters** (`store` builds HQ only when `mode === "standard"`).
- **Action points are charged per unit activation, not per action.** The first deploy/move/attack/heal/demolish involving a unit costs 1 AP; every further legal action by that same unit in the same turn is free. Per-unit limits still apply: at most one move (`hasMoved`) and one attack/heal/demolish (`hasActed`) per unit.
  - **Move + attack/heal** — in either order — costs **1 AP total**.
  - **Deploy + attack/heal** also costs **1 AP total**. A deployed unit is created already activated (`hasMoved: true`, `actionSpent: true`), so it **cannot move** that turn, but `hasActed` is false: it **can attack or heal immediately for free** if a target is already in range from the deploy cell.
  - `actionsUsed >= actionsPerTurn` blocks only **new activations** (`action_limit_reached`); units already activated keep their free follow-up action.
- **Deploy origins:** your HQ **or** an owned control point, into an adjacent empty plain cell.
  - `fromId` = your HQ entity id **or** owned CP id.
  - A map may set `balance.deployFromHq: false` — the HQ is then **not** a legal deploy origin; only owned CPs are. Check `config.balance.deployFromHq` before planning an HQ deploy; an HQ-deploy on such a map is rejected (`invalid_deploy`).
  - A map may also ban deploy per CP kind: `balance.controlPointTypes.<kind>.canDeploy: false` makes owned CPs of that kind illegal origins (rejected `invalid_deploy`); kinds without the flag stay deployable.
- **Elimination:** destroying a player's HQ eliminates them — units removed, their CPs go neutral, resources freeze; match continues for remaining players.
- **Adjudication** uses the shared formula in `SKILL.md`: HQ damage, own HQ HP, CPs (time-averaged hold + final snapshot), army value, supplies, **and `killValue`**. Enemy HQ damage accumulates across opponents in multiplayer.
- `killValue` = total cost of enemy units **you** killed (last hit). Securing kills beats chip damage: non-lethal damage scores nothing directly.
- CP scoring is mostly **flow**: holding a point every round is worth far more than grabbing it on the last round (`controlPointFlowRatio`, default 0.7).
- Read `adjudication.scores.<you>` and rival breakdowns; do not recompute.
- **Movement path uses the current board**: water/blockers, all units (**friendly and enemy**), and all living HQs block both the path and the destination. There is no plan queue — moves execute immediately, so a unit that moves away can open a cell for a later unit in the same turn.
- Prefer HQ pressure when board state and non-zero HQ weights reward it.

## Decision order

Unless the user asks for a different style:

1. **Attack the weakest nearby enemy HQ** any unit can hit. Prefer nearest low-HP living HQ among opponents.
2. **Attack killable / low-HP enemy units** — "killable" = `attack − defense − damageVarianceRange ≥ hp` (combat is stochastic; see Combat math in [`SKILL.md`](SKILL.md) for the variance bands and kill probabilities); prefer support, ranger, and capturers. Ignore eliminated seats.
3. **Heal** the most damaged friendly with support.
4. **Demolish** an adjacent blocker with heavy when it opens CPs, deploy space, attack lanes, or a path to an enemy HQ.
5. **Deploy** before ordinary moves when supplies + AP remain — especially high supplies, army not ahead of the strongest living rival, ≥2 owned CPs, or late game.
   - Comeback supplies: rebuild or contest income CPs; grants may stop when the gap closes.
   - `fromId` must be HQ id or owned CP id — HQ only when the map allows it (`config.balance.deployFromHq` is not `false`), and the CP's kind must not be deploy-banned (`controlPointTypes.<kind>.canDeploy: false`).
   - Prefer a deploy cell that already puts a target in the new unit's `attackRange` / `healRange`: the new unit cannot move this turn, but its attack/heal is free (deploy + attack = 1 AP total).
6. **Early:** move infantry/scouts to neutral or enemy CPs. `supply` early, `forward_base` for sustained pressure, `repair` when wounded units can hold nearby.
7. **Late:** move scouts/rangers/infantry onto best enemy **HQ** attack hexes.
8. **Near adjudication:** read `adjudication.scores` / `weights` / `leaders` / `margin`. Prioritize non-zero levers: HQ damage, CPs (keep them **held** — flow beats last-round grabs), valuable army survival, **securing kills** (last hit banks the victim's full cost as `killValue`), and convert excess supplies into units when AP/deploy hexes exist (built-in maps give supplies **0** weight — unspent supplies are worthless at the horn). HQ damage already dealt to now-eliminated rivals still counts. On an unlimited map (`config.balance.maxTurns === null`) there is no final round to time: only elimination or the host's `/force-adjudicate` ends it, so keep contesting income CPs instead of banking for a cap.
9. **No useful action** → `/end-turn`.

## Pre-action checks

- Stats from **this** map's `config.units` / unit instance — not memory
- Unit can move/act as required; target within **that unit's** `attackRange` or path within `moveRange`
- Capture only if `canCapture`; heal only with support → friendly unit; demolish only with heavy → adjacent empty blocker
- Destination in `game.cells` and otherwise legal
- Deploy `fromId` is **your living HQ or an owned CP**; cost from `config.units[type]`
- AP: a new activation needs 1 remaining AP; follow-ups on already-activated units are free. A unit deployed this turn may attack/heal (not move)
