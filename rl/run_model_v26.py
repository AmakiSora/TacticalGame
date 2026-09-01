"""Run v2.6 MaskablePPO models with the frozen 5,974-dim environment."""

import sys
from pathlib import Path

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
