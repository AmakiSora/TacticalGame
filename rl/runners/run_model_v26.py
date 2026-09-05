"""Run v2.6 MaskablePPO models with the frozen 5,974-dim environment."""

import sys
from pathlib import Path

# rl/ 已重组为 envs/runners/training/evaluation 子目录；把各代码目录挂上 sys.path，
# 让被转发的 run_model_v24 能以扁平模块名找到 rl/envs 下的冻结快照。
_RL_ROOT = Path(__file__).resolve().parent.parent
for _sub in ("envs", "runners", "training", "evaluation"):
    _p = str(_RL_ROOT / _sub)
    if _p not in sys.path:
        sys.path.insert(0, _p)

try:
    from .run_model_v24 import main
except ImportError:
    from run_model_v24 import main


if __name__ == "__main__":
    if "--model" not in sys.argv:
        candidates = list(Path("rl/models").glob("hex_ppo_v2.6.*_*_*.zip"))
        if not candidates:
            raise FileNotFoundError("未找到 v2.6 模型，请通过 --model 指定路径")
        sys.argv.extend(("--model", str(max(candidates, key=lambda path: path.stat().st_mtime))))
    main()
