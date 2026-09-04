"""v3.0 cold start: distil a frozen v2.7/v2.8 teacher into a fresh v3.0 policy.

Why: the v3.0 observation (6,715 dims, candidate descriptors) and action space
(155 hierarchical actions) cannot load v2.x weights, and every v2 generation
spent its first ~1M PPO frames rediscovering "capture points, deploy, attack".
The teacher's 54 actions map one-to-one onto v3.0 candidate 0 of the same slot
(``env.map_v27_action``), so behaviour cloning gives the new policy the
teacher's skill on the shared sub-space while leaving the new candidates
(directions 1-6, alternative targets, CP-side deploy) to be discovered by PPO.

Two phases:

1. ``collect``: play N games where the *teacher* acts on both seats (self-play)
   or against the rule opponent, inside ``LocalHexGameEnv`` (v3.0 encoding),
   and store (observation, action mask, teacher action, discounted return).
2. ``train``: build a MaskablePPO with the requested extractor, then minimise
   masked cross-entropy on the teacher action plus MSE on the return for the
   value head.  Save as a normal sb3 zip that ``train.py`` can resume from
   with ``RL_LOAD_MODEL``.

Usage:
    python rl/distill.py collect --teacher rl/models/hex_ppo_v2.7.0_... --games 400 --out rl/distill/v27_teacher.npz
    python rl/distill.py train --data rl/distill/v27_teacher.npz --out rl/models/hex_ppo_v3.0.0_distilled --extractor hex_transformer
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import env as E  # noqa: E402
from local_env import LocalHexGameEnv  # noqa: E402


def collect(args: argparse.Namespace) -> None:
    from sb3_contrib import MaskablePPO

    torch.set_num_threads(max(1, args.threads))
    teacher = MaskablePPO.load(args.teacher, device="cpu", custom_objects={"learning_rate": 0.0, "lr_schedule": lambda _: 0.0})
    n_teacher_actions = int(teacher.action_space.n)
    if n_teacher_actions != E.V27_ACTIONS:
        raise ValueError(f"teacher must be a 54-action v2.7/v2.8 model, got {n_teacher_actions}")
    map_mix = [("random", 0.7), ("default", 0.15), ("dual-lanes", 0.075), ("forge", 0.075)]
    # Opponent: the same teacher (self-play) for `self_play_ratio` of games, rules otherwise.
    env_self = LocalHexGameEnv(map_id="random", opponent_style="mixed", map_mix=map_mix, self_play_probability=1.0, anchor_model_path=args.teacher, anchor_probability=1.0)
    env_rule = LocalHexGameEnv(map_id="random", opponent_style="mixed", map_mix=map_mix)
    helper = env_self._v27_helper()
    obs_buf: list[np.ndarray] = []
    mask_buf: list[np.ndarray] = []
    act_buf: list[int] = []
    ret_buf: list[float] = []
    wins = 0
    started = time.time()
    rng = np.random.default_rng(args.seed)
    for game in range(args.games):
        env = env_self if rng.random() < args.self_play_ratio else env_rule
        observation, _ = env.reset(seed=args.seed * 100_000 + game)
        helper.unit_slots = env.unit_slots
        episode_obs: list[np.ndarray] = []
        episode_mask: list[np.ndarray] = []
        episode_act: list[int] = []
        episode_rew: list[float] = []
        done = False
        while not done:
            actions = env.actions
            v27_mask, _ = env._candidate_action_mask(teacher, actions, env.owner)
            v27_obs = helper._encode_from_perspective(env.state, env.owner)
            # epsilon-mix: a little stochasticity broadens the state coverage.
            stochastic = rng.random() < args.teacher_stochastic
            teacher_action, _ = teacher.predict(v27_obs, deterministic=not stochastic, action_masks=v27_mask)
            action = E.map_v27_action(int(teacher_action))
            if not actions[action][0]:
                action = 0
            episode_obs.append(observation.astype(np.float32))
            episode_mask.append(env.action_masks().copy())
            episode_act.append(action)
            observation, reward, terminated, truncated, _ = env.step(action)
            episode_rew.append(float(reward))
            done = terminated or truncated
        if env.state.get("winner") == env.owner:
            wins += 1
        # Discounted return-to-go as the value target.
        running = 0.0
        returns = np.zeros(len(episode_rew), dtype=np.float32)
        for index in range(len(episode_rew) - 1, -1, -1):
            running = episode_rew[index] + args.gamma * running
            returns[index] = running
        obs_buf.extend(episode_obs)
        mask_buf.extend(episode_mask)
        act_buf.extend(episode_act)
        ret_buf.extend(returns.tolist())
        if (game + 1) % 10 == 0:
            elapsed = time.time() - started
            print(f"[collect] game {game + 1}/{args.games} samples={len(act_buf)} teacher_wins={wins / (game + 1):.0%} elapsed={elapsed:.0f}s", flush=True)
    env_self.close()
    env_rule.close()
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.out,
        obs=np.stack(obs_buf).astype(np.float16),  # 6715 dims x ~100k samples; fp16 halves disk
        mask=np.stack(mask_buf),
        act=np.asarray(act_buf, dtype=np.int64),
        ret=np.asarray(ret_buf, dtype=np.float32),
    )
    print(f"[collect] saved {len(act_buf)} samples to {args.out}; teacher win rate {wins / max(1, args.games):.0%}")


def train(args: argparse.Namespace) -> None:
    from sb3_contrib import MaskablePPO
    from sb3_contrib.common.wrappers import ActionMasker

    from extractors import build_policy_kwargs

    data = np.load(args.data)
    obs = torch.from_numpy(data["obs"].astype(np.float32))
    mask = torch.from_numpy(data["mask"])
    act = torch.from_numpy(data["act"])
    ret = torch.from_numpy(data["ret"])
    n = obs.shape[0]
    print(f"[train] {n} samples, obs {tuple(obs.shape[1:])}, actions {int(mask.shape[1])}", flush=True)
    device = "cuda" if torch.cuda.is_available() and args.device != "cpu" else "cpu"

    # Build the sb3 model against a real env so spaces/metadata are correct.
    env = ActionMasker(LocalHexGameEnv(map_id="random"), lambda e: e.action_masks())
    model = MaskablePPO(
        "MlpPolicy", env,
        policy_kwargs=build_policy_kwargs(args.extractor, args.net_width),
        n_steps=64, batch_size=64, device=device, verbose=0,
        learning_rate=args.lr,
    )
    policy = model.policy
    optimizer = torch.optim.AdamW(policy.parameters(), lr=args.lr, weight_decay=1e-4)
    steps_per_epoch = (n + args.batch_size - 1) // args.batch_size
    scheduler = torch.optim.lr_scheduler.OneCycleLR(optimizer, max_lr=args.lr, total_steps=args.epochs * steps_per_epoch, pct_start=0.1)
    holdout = max(1, int(n * 0.05))
    perm = torch.randperm(n)
    val_idx, train_idx = perm[:holdout], perm[holdout:]
    # The value head must predict returns on the SAME scale PPO uses for GAE.
    # An earlier revision divided the targets by their std; PPO then read a
    # 6x-underestimated V(s), advantages blew up, and the cloned policy
    # collapsed from 74% to 11% win rate over the first million frames before
    # slowly relearning.  Train on raw returns and use Huber so the large
    # magnitude (win reward is +-5) stays numerically well behaved.
    print(f"[train] return targets: mean {float(ret.mean()):+.2f} std {float(ret.std()):.2f} "
          f"range [{float(ret.min()):+.2f}, {float(ret.max()):+.2f}] (unscaled, PPO-compatible)", flush=True)

    def batch_loss(idx: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        o = obs[idx].to(device)
        m = mask[idx].to(device)
        a = act[idx].to(device)
        r = ret[idx].to(device)
        features = policy.extract_features(o)
        if policy.share_features_extractor:
            latent_pi, latent_vf = policy.mlp_extractor(features)
        else:
            pi_features, vf_features = features
            latent_pi = policy.mlp_extractor.forward_actor(pi_features)
            latent_vf = policy.mlp_extractor.forward_critic(vf_features)
        logits = policy.action_net(latent_pi)
        logits = logits.masked_fill(~m, -1e9)
        ce = torch.nn.functional.cross_entropy(logits, a)
        values = policy.value_net(latent_vf).squeeze(-1)
        value_loss = torch.nn.functional.smooth_l1_loss(values, r)
        acc = (logits.argmax(dim=-1) == a).float().mean()
        return ce, value_loss, acc

    policy.train()
    for epoch in range(args.epochs):
        order = train_idx[torch.randperm(len(train_idx))]
        tot_ce = tot_value = tot_acc = 0.0
        batches = 0
        for start in range(0, len(order), args.batch_size):
            idx = order[start:start + args.batch_size]
            ce, value_loss, acc = batch_loss(idx)
            loss = ce + args.value_coef * value_loss
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(policy.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            tot_ce += float(ce); tot_value += float(value_loss); tot_acc += float(acc); batches += 1
        policy.eval()
        with torch.no_grad():
            v_ce, v_value, v_acc = batch_loss(val_idx)
        policy.train()
        print(
            f"[train] epoch {epoch + 1}/{args.epochs} ce={tot_ce / batches:.3f} acc={tot_acc / batches:.1%} "
            f"vloss={tot_value / batches:.3f} | val ce={float(v_ce):.3f} acc={float(v_acc):.1%} vloss={float(v_value):.3f}",
            flush=True,
        )
    policy.eval()
    out = args.out if args.out.endswith(".zip") else args.out + ".zip"
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    model.save(out)
    # Sanity gate: report how far the value head is off on the held-out split.
    # If this is large relative to the return std, PPO's first GAE pass will
    # produce wild advantages and wreck the cloned policy.
    with torch.no_grad():
        o = obs[val_idx].to(device)
        features = policy.extract_features(o)
        if policy.share_features_extractor:
            _, latent_vf = policy.mlp_extractor(features)
        else:
            latent_vf = policy.mlp_extractor.forward_critic(features[1])
        predicted = policy.value_net(latent_vf).squeeze(-1).cpu()
    rmse = float(((predicted - ret[val_idx]) ** 2).mean().sqrt())
    env.close()
    print(f"[train] saved distilled v3.0 policy to {out} (extractor={args.extractor})")
    print(f"[train] value head holdout RMSE {rmse:.2f} vs return std {float(ret.std()):.2f} "
          f"— PPO 续训前应远小于 std，否则首轮 GAE 会摧毁克隆策略")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    c = sub.add_parser("collect")
    c.add_argument("--teacher", required=True)
    c.add_argument("--games", type=int, default=400)
    c.add_argument("--out", default="rl/distill/v27_teacher.npz")
    c.add_argument("--self-play-ratio", type=float, default=0.7)
    c.add_argument("--teacher-stochastic", type=float, default=0.15, help="fraction of teacher moves sampled instead of argmax")
    c.add_argument("--gamma", type=float, default=0.99)
    c.add_argument("--seed", type=int, default=7)
    c.add_argument("--threads", type=int, default=2)
    c.set_defaults(func=collect)

    t = sub.add_parser("train")
    t.add_argument("--data", default="rl/distill/v27_teacher.npz")
    t.add_argument("--out", default="rl/models/hex_ppo_v3.0.0_distilled")
    t.add_argument("--extractor", default=os.environ.get("RL_EXTRACTOR", "hex_transformer"), choices=("mlp", "hex_transformer"))
    t.add_argument("--net-width", type=int, default=256)
    t.add_argument("--epochs", type=int, default=8)
    t.add_argument("--batch-size", type=int, default=512)
    t.add_argument("--lr", type=float, default=1e-3)
    t.add_argument("--value-coef", type=float, default=0.5)
    t.add_argument("--device", default="auto")
    t.set_defaults(func=train)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
