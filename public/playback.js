(() => {
  // 结算回放的紧凑节奏（毫秒）。桶划分镜像服务端 resolveRound 的阶段顺序：
  // shift（部署/移动/爆破及伴随失败）与 boundary（回合边界/经济事件）桶内
  // 连续事件同拍应用——同时模式的移动本就同时发生，齐动更符合语义且总时长
  // 更短；combat/capture 桶逐事件应用，间隔为该类型的演出时长。
  const SHIFT_TYPES = new Set(['deploy', 'move', 'demolish', 'action_failed']);
  const COMBAT_DELAYS = {
    attack: 480,
    heal: 340,
    unit_death: 420,
    headquarters_destroyed: 520,
    player_eliminated: 340,
    control_point_neutralized: 300,
  };
  const CAPTURE_DELAY = 260;
  const SHIFT_BEAT_MS = 600;
  const BOUNDARY_BEAT_MS = 140;

  function bucketOf(type) {
    if (SHIFT_TYPES.has(type)) return 'shift';
    if (Object.prototype.hasOwnProperty.call(COMBAT_DELAYS, type)) return 'combat';
    if (type === 'control_point_captured') return 'capture';
    return 'boundary';
  }

  function create(controls) {
    const queue = [];
    let timer = null;
    let draining = false;
    let active = false;
    let lastSeenSeq = 0;

    function knownSeq() {
      return Math.max(lastSeenSeq, Number(controls.lastSeq?.()) || 0);
    }

    // 页面切到后台时跳过节拍等待，避免浏览器限流把回放拖成慢动作。
    function paced(delay) {
      return typeof document !== 'undefined' && document.hidden ? 0 : delay;
    }

    function cancelTimer() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function setActive(value) {
      if (active === value) return;
      active = value;
      controls.onActiveChange?.(value);
    }

    function finish() {
      cancelTimer();
      setActive(false);
      controls.refresh?.();
    }

    function drain() {
      timer = null;
      if (!queue.length) {
        finish();
        return;
      }
      setActive(true);
      draining = true;
      const bucket = bucketOf(queue[0].type);
      const batch = [];
      if (bucket === 'shift' || bucket === 'boundary') {
        while (queue.length && bucketOf(queue[0].type) === bucket) batch.push(queue.shift());
      } else {
        batch.push(queue.shift());
      }
      let delay = bucket === 'shift' ? SHIFT_BEAT_MS : BOUNDARY_BEAT_MS;
      for (const event of batch) {
        controls.apply(event);
        controls.effect(event);
        if (bucket === 'combat') delay = COMBAT_DELAYS[event.type] ?? BOUNDARY_BEAT_MS;
        else if (bucket === 'capture') delay = CAPTURE_DELAY;
      }
      controls.sync(batch.some(event => event.type !== 'game_start'));
      controls.render();
      draining = false;
      if (queue.length) timer = setTimeout(drain, paced(delay));
      else finish();
    }

    function enqueue(event) {
      if (!event || typeof event.seq !== 'number') return false;
      // 重连重放/重复投递：不早于已见或已应用序号的事件直接丢弃（状态与特效都不重播）。
      if (event.seq <= knownSeq()) return false;
      lastSeenSeq = event.seq;
      queue.push(event);
      // 首批延迟一个宏任务：同一结算爆发的其余事件先完成入队，移动组才能
      // 整拍齐动；单事件回合（顺序模式）仅多一个 tick，体感不变。
      if (!draining && timer === null) timer = setTimeout(drain, 0);
      return true;
    }

    function skip() {
      if (!active && !queue.length) return;
      cancelTimer();
      const remaining = queue.splice(0, queue.length);
      for (const event of remaining) {
        controls.apply(event);
        if (typeof event.seq === 'number') lastSeenSeq = Math.max(lastSeenSeq, event.seq);
      }
      controls.sync(false);
      controls.render();
      finish();
    }

    function reset() {
      cancelTimer();
      queue.length = 0;
      lastSeenSeq = 0;
      setActive(false);
    }

    return {
      enqueue,
      isActive: () => active || queue.length > 0,
      skip,
      reset,
    };
  }

  window.PlaybackQueue = { create };
})();
