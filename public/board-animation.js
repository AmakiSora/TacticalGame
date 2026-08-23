(() => {
  const EFFECT_LIMIT = 64;
  const POSITION_EASE = 0.2;
  const ALPHA_EASE = 0.16;
  const HP_EASE = 0.2;
  const HEAL_FLUSH_MS = 60;
  const ATTACK_FX_TTL_MS = 8000;

  // 与服务端 src/engine/hex.ts 的 HEX_DIRECTIONS 顺序保持一致。
  const HEX_DIRECTIONS = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
  ];

  // 旧模式（无 shape）按兵种类型映射的单格主题特效。
  const ATTACK_THEME = {
    infantry: { kind: 'pierce', color: '#ffb347' },
    scout: { kind: 'strike', color: '#9ae6ff' },
    heavy: { kind: 'slash', color: '#ff7a45' },
    ranger: { kind: 'beam', color: '#ff5c7a' },
  };
  const BEAM_THEME = { kind: 'beam', color: '#ff5c7a' };
  const LINE_COLOR = '#ffb347';
  const ARC_COLOR = '#ff7a45';
  const HIT_COLOR = '#ff3b5c';
  const HEAL_COLOR = '#3effc8';

  function create({ hexToPixel, ownerColor, unitSpec }) {
    const unitViews = new Map();
    const headquartersViews = new Map();
    let effects = [];
    // 演出级攻击特效去重：key -> 过期时间戳。多目标 line/arc 攻击会发多条事件，
    // 演出只播第一次；受击特效不去重。
    const attackFxPlayed = new Map();
    // 治疗演出聚合：同 supportId+roundNumber 的多条 heal 合并为一次范围治疗波。
    let pendingHealFx = [];

    function reducedMotion() {
      return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    }

    function safePixel(q, r) {
      if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
      const point = hexToPixel(q, r);
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
      return point;
    }

    function hexScale() {
      const a = safePixel(0, 0);
      const b = safePixel(1, 0);
      if (!a || !b) return 1;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      return Number.isFinite(d) && d > 0 ? Math.min(1.4, Math.max(0.6, d / 52)) : 1;
    }

    function unitTypeOf(state, id) {
      return state?.units?.get?.(id)?.type;
    }

    function entityQR(state, id) {
      const entity = state?.units?.get?.(id) || state?.headquarters?.get?.(id);
      return entity && Number.isFinite(entity.q) && Number.isFinite(entity.r)
        ? { q: entity.q, r: entity.r }
        : null;
    }

    // 镜像服务端 planning.ts shapeSpecFor：未配置默认 single。
    function shapeSpecOf(type, kind) {
      const shape = unitSpec?.(type)?.[kind];
      if (!shape) return { type: 'single', length: 1 };
      if (shape.type === 'line') return { type: 'line', length: shape.length ?? 2 };
      if (shape.type === 'arc') return { type: 'arc', length: 3 };
      return { type: 'single', length: 1 };
    }

    // 镜像服务端 planning.ts coveredCellsFor 的形状推导（不做射程校验——
    // 事件已结算，直接信任）。返回格子数组，推导失败返回 null。
    function coveredCellsFrom(from, shape, aimQ, aimR) {
      const dq = aimQ - from.q;
      const dr = aimR - from.r;
      if (shape.type === 'single') return [{ q: aimQ, r: aimR }];
      if (shape.type === 'arc') {
        const direction = HEX_DIRECTIONS.findIndex(d => d.q === dq && d.r === dr);
        if (direction < 0) return null;
        return [(direction + 5) % 6, direction, (direction + 1) % 6].map(index => ({
          q: from.q + HEX_DIRECTIONS[index].q,
          r: from.r + HEX_DIRECTIONS[index].r,
        }));
      }
      // line：瞄准格落在某个正六方向射线上，距离 1..length。
      for (let dir = 0; dir < 6; dir++) {
        const d = HEX_DIRECTIONS[dir];
        const k = d.q !== 0 ? dq / d.q : dr / d.r;
        if (!Number.isInteger(k) || k < 1 || k > shape.length) continue;
        if (d.q * k !== dq || d.r * k !== dr) continue;
        const cells = [];
        for (let step = 1; step <= shape.length; step++) {
          cells.push({ q: from.q + d.q * step, r: from.r + d.r * step });
        }
        return cells;
      }
      return null;
    }

    function markAttackFxOnce(key) {
      const now = performance.now();
      for (const [k, expiry] of attackFxPlayed) {
        if (expiry <= now) attackFxPlayed.delete(k);
      }
      if (attackFxPlayed.has(key)) return false;
      attackFxPlayed.set(key, now + ATTACK_FX_TTL_MS);
      return true;
    }

    function syncEntities(entities, views, immediate) {
      const seen = new Set();
      for (const entity of entities?.values?.() || []) {
        if (!entity?.id) continue;
        seen.add(entity.id);
        const existing = views.get(entity.id);
        if (entity.alive === false) {
          if (existing) {
            existing.targetAlpha = 0;
            if (immediate) views.delete(entity.id);
          }
          continue;
        }

        const target = safePixel(entity.q, entity.r);
        if (!target) continue;
        if (!existing) {
          views.set(entity.id, {
            entity: { ...entity },
            x: target.x,
            y: target.y,
            tx: target.x,
            ty: target.y,
            alpha: immediate ? 1 : 0,
            targetAlpha: 1,
            scale: immediate ? 1 : 0.6,
            targetScale: 1,
            hp: Number(entity.hp) || 0,
            targetHp: Number(entity.hp) || 0,
          });
          continue;
        }

        existing.entity = { ...entity };
        existing.tx = target.x;
        existing.ty = target.y;
        existing.targetAlpha = 1;
        existing.targetScale = 1;
        existing.targetHp = Number(entity.hp) || 0;
        if (immediate) {
          existing.x = target.x;
          existing.y = target.y;
          existing.alpha = 1;
          existing.scale = 1;
          existing.hp = existing.targetHp;
        }
      }

      for (const [id, view] of views) {
        if (seen.has(id)) continue;
        if (immediate) views.delete(id);
        else view.targetAlpha = 0;
      }
    }

    function syncState(state, { animate = true } = {}) {
      const immediate = !animate || reducedMotion();
      syncEntities(state?.units, unitViews, immediate);
      syncEntities(state?.headquarters, headquartersViews, immediate);
    }

    function entityPosition(id) {
      if (!id) return null;
      const view = unitViews.get(id) || headquartersViews.get(id);
      return view ? { x: view.x, y: view.y } : null;
    }

    function addEffect(effect) {
      if (!effect || !Number.isFinite(effect.x) || !Number.isFinite(effect.y)) return;
      if (effects.length >= EFFECT_LIMIT) effects.shift();
      effects.push({
        ...effect,
        start: performance.now(),
        duration: reducedMotion() ? 1 : effect.duration,
      });
    }

    function addBeam(from, to, color, duration) {
      if (!from || !to) return;
      addEffect({ kind: 'beam', x: from.x, y: from.y, x2: to.x, y2: to.y, color, duration });
    }

    function addRing(at, color, duration, size = 1) {
      if (!at) return;
      addEffect({ kind: 'ring', x: at.x, y: at.y, color, duration, size });
    }

    function addBurst(at, color, duration, size = 1) {
      if (!at) return;
      addEffect({ kind: 'burst', x: at.x, y: at.y, color, duration, size });
    }

    function addFlash(at, color, duration) {
      if (!at) return;
      addEffect({ kind: 'flash', x: at.x, y: at.y, color, duration, size: 1 });
    }

    function addPierce(from, cells, color) {
      if (!from || !cells?.length) return;
      const sorted = [...cells].sort((a, b) =>
        (Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y)));
      addEffect({
        kind: 'pierce',
        x: from.x,
        y: from.y,
        cells: sorted.map(c => ({ x: c.x, y: c.y })),
        color,
        duration: 320 + sorted.length * 90,
      });
    }

    function addStrike(at, color) {
      if (!at) return;
      addEffect({ kind: 'strike', x: at.x, y: at.y, color, duration: 300 });
    }

    // 挥砍顺序：把覆盖格投影到"与攻击方向垂直且与屏幕 x 正相关"的轴上排序，
    // 保证视觉上从左到右扫过。
    function sortForSweep(from, cells) {
      if (!cells || cells.length < 2) return cells ? [...cells] : [];
      const cx = cells.reduce((sum, c) => sum + c.x, 0) / cells.length;
      const cy = cells.reduce((sum, c) => sum + c.y, 0) / cells.length;
      let dx = cx - from.x;
      let dy = cy - from.y;
      const length = Math.hypot(dx, dy) || 1;
      dx /= length;
      dy /= length;
      let px = -dy;
      let py = dx;
      if (px < 0 || (px === 0 && py < 0)) { px = -px; py = -py; }
      return [...cells].sort((a, b) => {
        const pa = (a.x - from.x) * px + (a.y - from.y) * py;
        const pb = (b.x - from.x) * px + (b.y - from.y) * py;
        return pa - pb || a.x - b.x;
      });
    }

    function addSlash(from, cells, color) {
      if (!from || !cells?.length) return;
      addEffect({
        kind: 'slash',
        x: from.x,
        y: from.y,
        cells: cells.map(c => ({ x: c.x, y: c.y })),
        color,
        duration: cells.length > 1 ? 480 : 320,
      });
    }

    function addHealWave(at, cells) {
      const base = at || cells?.[0];
      if (!base) return;
      addEffect({
        kind: 'healWave',
        x: base.x,
        y: base.y,
        cells: (cells || []).map(c => ({ x: c.x, y: c.y })),
        color: HEAL_COLOR,
        duration: 600,
      });
    }

    function addHitFlash(at) {
      if (!at) return;
      addEffect({ kind: 'hitFlash', x: at.x, y: at.y, color: HIT_COLOR, duration: 220, size: 1 });
    }

    function addDamageText(at, text, color) {
      if (!at || !text) return;
      addEffect({ kind: 'damageText', x: at.x, y: at.y, text, color, duration: 800 });
    }

    function flushPendingHeals(now) {
      if (!pendingHealFx.length) return;
      if (now - pendingHealFx[0].time < HEAL_FLUSH_MS) return;
      const groups = new Map();
      for (const item of pendingHealFx) {
        if (!groups.has(item.key)) groups.set(item.key, []);
        groups.get(item.key).push(item);
      }
      pendingHealFx = [];
      for (const items of groups.values()) {
        const supportPos = entityPosition(items[0].supportId);
        const cells = [];
        for (const item of items) {
          const pos = entityPosition(item.targetId);
          if (!pos) continue;
          cells.push(pos);
          if (Number(item.amount) > 0) addDamageText(pos, `+${item.amount}`, HEAL_COLOR);
        }
        if (supportPos || cells.length) addHealWave(supportPos, cells);
      }
    }

    function controlPointPosition(state, id) {
      const point = state?.controlPoints?.get?.(id);
      return point ? safePixel(point.q, point.r) : null;
    }

    function recordAttack(payload, event, state) {
      const p = payload;
      const fromPos = entityPosition(p.attackerId);
      const attackerType = unitTypeOf(state, p.attackerId);
      const theme = ATTACK_THEME[attackerType] || BEAM_THEME;
      const fxKey = `${p.attackerId}|${p.roundNumber ?? event?.seq ?? 'legacy'}`;

      if (p.shape) {
        // 新模式：形状攻击（允许对空格子，hit:false 也播演出）。
        if (markAttackFxOnce(fxKey) && fromPos) {
          if (p.locked || p.shape === 'single') {
            const aimQ = Number.isFinite(p.aimQ) ? p.aimQ : p.q;
            const aimR = Number.isFinite(p.aimR) ? p.aimR : p.r;
            const to = p.hit ? entityPosition(p.targetId) : safePixel(aimQ, aimR);
            if (to) {
              if (!p.locked && theme.kind === 'strike') addStrike(to, theme.color);
              else addBeam(fromPos, to, BEAM_THEME.color, 220);
            }
          } else {
            const fromQR = entityQR(state, p.attackerId);
            const spec = shapeSpecOf(attackerType, 'attackShape');
            const aimQ = Number.isFinite(p.aimQ) ? p.aimQ : p.q;
            const aimR = Number.isFinite(p.aimR) ? p.aimR : p.r;
            if (fromQR && Number.isFinite(aimQ) && Number.isFinite(aimR)) {
              const covered = coveredCellsFrom(fromQR, { type: p.shape, length: spec.length }, aimQ, aimR)
                || [{ q: aimQ, r: aimR }];
              const cellsPx = covered.map(c => safePixel(c.q, c.r)).filter(Boolean);
              if (cellsPx.length) {
                if (p.shape === 'line') addPierce(fromPos, cellsPx, LINE_COLOR);
                else if (p.shape === 'arc') addSlash(fromPos, sortForSweep(fromPos, cellsPx), ARC_COLOR);
              }
            }
          }
        }
        if (p.hit === true) {
          const to = entityPosition(p.targetId);
          if (to) {
            addHitFlash(to);
            if (Number(p.actualDamage) > 0) addDamageText(to, `-${p.actualDamage}`, '#ff5c7a');
          }
        }
        return;
      }

      // 旧模式：只能攻击一格，按兵种主题缩为单格版本。
      const to = entityPosition(p.targetId);
      if (fromPos && to && markAttackFxOnce(fxKey)) {
        if (theme.kind === 'pierce') addPierce(fromPos, [to], theme.color);
        else if (theme.kind === 'strike') addStrike(to, theme.color);
        else if (theme.kind === 'slash') addSlash(fromPos, [to], theme.color);
        else addBeam(fromPos, to, BEAM_THEME.color, 220);
      }
      if (to) {
        addHitFlash(to);
        if (Number(p.actualDamage) > 0) addDamageText(to, `-${p.actualDamage}`, '#ff5c7a');
      }
    }

    function recordEvent(event, state) {
      flushPendingHeals(performance.now());
      const payload = event?.payload || {};
      switch (event?.type) {
        case 'attack':
          recordAttack(payload, event, state);
          break;
        case 'move':
          addRing(safePixel(payload.toQ, payload.toR), '#6ea8ff', 400, 0.8);
          break;
        case 'heal':
          pendingHealFx.push({
            key: `${payload.supportId}|${payload.roundNumber ?? event?.seq ?? 'legacy'}`,
            supportId: payload.supportId,
            targetId: payload.targetId,
            amount: payload.amount,
            time: performance.now(),
          });
          break;
        case 'control_point_repair':
          addRing(entityPosition(payload.unitId), '#3effc8', 450, 1);
          break;
        case 'deploy':
          addRing(safePixel(payload.q, payload.r), '#ffd23e', 500, 1.2);
          break;
        case 'unit_death':
          addBurst(entityPosition(payload.unitId), '#ff8a5c', 500, 1);
          break;
        case 'headquarters_destroyed': {
          const at = entityPosition(payload.headquartersId);
          addBurst(at, '#ff5c7a', 700, 1.8);
          addRing(at, '#ff5c7a', 700, 2);
          break;
        }
        case 'control_point_captured': {
          const point = state?.controlPoints?.get?.(payload.pointId);
          addRing(controlPointPosition(state, payload.pointId), ownerColor(point?.owner), 600, 1.5);
          break;
        }
        case 'control_point_neutralized':
          addRing(controlPointPosition(state, payload.pointId), '#d6b34a', 500, 1.2);
          break;
        case 'demolish':
          addBurst(safePixel(payload.q, payload.r), '#ff9a3d', 550, 1.3);
          break;
      }
    }

    function updateViewMap(views) {
      for (const [id, view] of views) {
        view.x += (view.tx - view.x) * POSITION_EASE;
        view.y += (view.ty - view.y) * POSITION_EASE;
        view.alpha += (view.targetAlpha - view.alpha) * ALPHA_EASE;
        view.scale += (view.targetScale - view.scale) * POSITION_EASE;
        view.hp += (view.targetHp - view.hp) * HP_EASE;

        if (Math.abs(view.tx - view.x) < 0.4) view.x = view.tx;
        if (Math.abs(view.ty - view.y) < 0.4) view.y = view.ty;
        if (Math.abs(view.targetAlpha - view.alpha) < 0.01) view.alpha = view.targetAlpha;
        if (Math.abs(view.targetScale - view.scale) < 0.01) view.scale = view.targetScale;
        if (Math.abs(view.targetHp - view.hp) < 0.5) view.hp = view.targetHp;
        if (view.targetAlpha === 0 && view.alpha <= 0.01) views.delete(id);
      }
    }

    function update(now) {
      flushPendingHeals(now);
      updateViewMap(unitViews);
      updateViewMap(headquartersViews);
      effects = effects.filter(effect => now - effect.start < effect.duration);
    }

    function viewMapIsActive(views) {
      for (const view of views.values()) {
        if (Math.abs(view.tx - view.x) >= 0.4) return true;
        if (Math.abs(view.ty - view.y) >= 0.4) return true;
        if (Math.abs(view.targetAlpha - view.alpha) >= 0.01) return true;
        if (Math.abs(view.targetScale - view.scale) >= 0.01) return true;
        if (Math.abs(view.targetHp - view.hp) >= 0.5) return true;
      }
      return false;
    }

    function isActive() {
      return effects.length > 0 || pendingHealFx.length > 0
        || viewMapIsActive(unitViews) || viewMapIsActive(headquartersViews);
    }

    function drawEffect(context, effect, progress) {
      if (progress < 0 || progress >= 1) return;
      const fade = 1 - progress;
      context.save();
      context.lineCap = 'round';
      context.shadowColor = effect.color;
      context.shadowBlur = 8;

      if (effect.kind === 'beam') {
        context.strokeStyle = effect.color;
        context.globalAlpha = fade * 0.9;
        context.lineWidth = 4 * fade + 1;
        context.beginPath();
        context.moveTo(effect.x, effect.y);
        context.lineTo(effect.x2, effect.y2);
        context.stroke();
      } else if (effect.kind === 'ring') {
        context.strokeStyle = effect.color;
        context.globalAlpha = fade * 0.85;
        context.lineWidth = 2.5;
        context.beginPath();
        context.arc(effect.x, effect.y, (6 + progress * 26) * effect.size, 0, Math.PI * 2);
        context.stroke();
      } else if (effect.kind === 'flash') {
        context.fillStyle = effect.color;
        context.globalAlpha = fade * 0.32;
        context.beginPath();
        context.arc(effect.x, effect.y, (10 + progress * 8) * effect.size, 0, Math.PI * 2);
        context.fill();
      } else if (effect.kind === 'burst') {
        const length = (5 + progress * 22) * effect.size;
        context.strokeStyle = effect.color;
        context.globalAlpha = fade;
        context.lineWidth = 2;
        for (let index = 0; index < 8; index++) {
          const angle = (Math.PI / 4) * index + progress * 0.6;
          context.beginPath();
          context.moveTo(effect.x + Math.cos(angle) * 3, effect.y + Math.sin(angle) * 3);
          context.lineTo(effect.x + Math.cos(angle) * length, effect.y + Math.sin(angle) * length);
          context.stroke();
        }
      } else if (effect.kind === 'pierce') {
        const s = hexScale();
        const cells = effect.cells || [];
        const last = cells[cells.length - 1];
        if (last) {
          context.strokeStyle = effect.color;
          context.globalAlpha = fade * 0.7;
          context.lineWidth = 3 * fade + 1;
          context.shadowBlur = 10;
          context.beginPath();
          context.moveTo(effect.x, effect.y);
          context.lineTo(last.x, last.y);
          context.stroke();
          const hx = effect.x + (last.x - effect.x) * progress;
          const hy = effect.y + (last.y - effect.y) * progress;
          context.fillStyle = effect.color;
          context.globalAlpha = 0.95 * (0.4 + fade * 0.6);
          context.beginPath();
          context.arc(hx, hy, 5 * s, 0, Math.PI * 2);
          context.fill();
          context.fillStyle = '#ffffff';
          context.globalAlpha = 0.9 * fade;
          context.beginPath();
          context.arc(hx, hy, 2 * s, 0, Math.PI * 2);
          context.fill();
        }
        for (let i = 0; i < cells.length; i++) {
          const t = Math.min(1, Math.max(0, progress * (cells.length + 1) - i));
          if (t <= 0 || t >= 1) continue;
          context.strokeStyle = effect.color;
          context.globalAlpha = (1 - t) * 0.8;
          context.lineWidth = 2;
          context.beginPath();
          context.arc(cells[i].x, cells[i].y, (4 + t * 14) * s, 0, Math.PI * 2);
          context.stroke();
        }
      } else if (effect.kind === 'strike') {
        const s = hexScale();
        const outer = (8 + 26 * fade) * s;
        context.strokeStyle = effect.color;
        context.globalAlpha = fade;
        context.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          const angle = (Math.PI / 2) * i + Math.PI / 4;
          context.beginPath();
          context.moveTo(effect.x + Math.cos(angle) * outer, effect.y + Math.sin(angle) * outer);
          context.lineTo(
            effect.x + Math.cos(angle) * (outer - 8 * s),
            effect.y + Math.sin(angle) * (outer - 8 * s),
          );
          context.stroke();
        }
        context.fillStyle = effect.color;
        context.globalAlpha = fade * 0.5;
        context.beginPath();
        context.arc(effect.x, effect.y, (6 + progress * 6) * s, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = fade * 0.9;
        context.lineWidth = 1.5;
        const c = 5 * s;
        context.beginPath();
        context.moveTo(effect.x - c, effect.y);
        context.lineTo(effect.x + c, effect.y);
        context.moveTo(effect.x, effect.y - c);
        context.lineTo(effect.x, effect.y + c);
        context.stroke();
      } else if (effect.kind === 'slash') {
        const s = hexScale();
        const cells = effect.cells || [];
        const n = cells.length;
        // 逐格错峰：第 i 格的局部进度，最后一格恰好随特效结束播完。
        const stagger = 0.55;
        const span = (n - 1) * stagger + 1;
        for (let i = 0; i < n; i++) {
          const t = Math.min(1, Math.max(0, progress * span - i * stagger));
          if (t <= 0 || t >= 1) continue;
          const cell = cells[i];
          const baseAngle = Math.atan2(cell.y - effect.y, cell.x - effect.x);
          const radius = Math.hypot(cell.x - effect.x, cell.y - effect.y);
          if (radius <= 0) continue;
          const sweep = 1.0;
          // 挥砍时间轴：前 70% 刀身从起点转到终点，最后 30% 停在终点淡出。
          const grow = Math.min(1, t / 0.7);
          const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
          const startAngle = baseAngle - sweep / 2;
          const bladeAngle = startAngle + sweep * grow;

          // 刀光残影：跟在刀身后方的一小段弧。
          context.strokeStyle = effect.color;
          context.globalAlpha = alpha * 0.55;
          context.lineWidth = 3.5 * s;
          context.shadowBlur = 12;
          context.beginPath();
          context.arc(effect.x, effect.y, radius, Math.max(startAngle, bladeAngle - 0.55), bladeAngle);
          context.stroke();

          // 刀身：以攻击者为轴心旋转的一把刀，刀尖略超出目标格。
          context.save();
          context.translate(effect.x, effect.y);
          context.rotate(bladeAngle);
          const hilt = radius * 0.16;
          const tip = radius * 1.12;
          const w = 5.5 * s;
          let bladeFill = '#e8eef7';
          if (typeof context.createLinearGradient === 'function') {
            const grad = context.createLinearGradient(hilt, 0, tip, 0);
            grad.addColorStop(0, '#aeb9c9');
            grad.addColorStop(0.65, '#eef2f8');
            grad.addColorStop(1, '#ffffff');
            bladeFill = grad;
          }
          context.globalAlpha = alpha;
          context.shadowColor = effect.color;
          context.shadowBlur = 10;
          context.fillStyle = bladeFill;
          context.beginPath();
          context.moveTo(hilt, -w * 0.32);
          context.lineTo(tip - 9 * s, -w);
          context.lineTo(tip, 0);
          context.lineTo(tip - 9 * s, w * 0.5);
          context.lineTo(hilt, w * 0.32);
          context.closePath();
          context.fill();
          // 刀刃高光
          context.shadowBlur = 0;
          context.strokeStyle = 'rgba(255, 255, 255, 0.95)';
          context.globalAlpha = alpha * 0.9;
          context.lineWidth = 1.2 * s;
          context.beginPath();
          context.moveTo(hilt + 4 * s, w * 0.18);
          context.lineTo(tip - 5 * s, w * 0.1);
          context.stroke();
          // 护手
          context.strokeStyle = '#5c4632';
          context.globalAlpha = alpha;
          context.lineWidth = 2.2 * s;
          context.beginPath();
          context.moveTo(hilt, -w * 0.9);
          context.lineTo(hilt, w * 0.9);
          context.stroke();
          context.restore();

          // 格内劈痕
          const sx = -Math.sin(baseAngle);
          const sy = Math.cos(baseAngle);
          context.strokeStyle = effect.color;
          context.globalAlpha = alpha * 0.7;
          context.lineWidth = 2;
          context.beginPath();
          context.moveTo(cell.x - sx * 7 * s * grow, cell.y - sy * 7 * s * grow);
          context.lineTo(cell.x + sx * 7 * s * grow, cell.y + sy * 7 * s * grow);
          context.stroke();
        }
      } else if (effect.kind === 'healWave') {
        const s = hexScale();
        context.strokeStyle = effect.color;
        context.globalAlpha = fade * 0.85;
        context.lineWidth = 2.5;
        context.beginPath();
        context.arc(effect.x, effect.y, (6 + progress * 20) * s, 0, Math.PI * 2);
        context.stroke();
        context.globalAlpha = fade * 0.6;
        context.beginPath();
        context.arc(effect.x, effect.y, (3 + progress * 12) * s, 0, Math.PI * 2);
        context.stroke();
        context.fillStyle = effect.color;
        for (const cell of effect.cells || []) {
          context.globalAlpha = fade * 0.25;
          context.beginPath();
          context.arc(cell.x, cell.y, 10 * s, 0, Math.PI * 2);
          context.fill();
          for (let i = 0; i < 3; i++) {
            context.globalAlpha = fade * 0.8;
            context.beginPath();
            context.arc(
              cell.x + (i - 1) * 4 * s,
              cell.y - progress * 16 * s - i * 4 * s,
              2 * s, 0, Math.PI * 2,
            );
            context.fill();
          }
        }
      } else if (effect.kind === 'hitFlash') {
        const s = hexScale();
        context.fillStyle = effect.color;
        context.globalAlpha = fade * 0.45;
        context.beginPath();
        context.arc(effect.x, effect.y, (10 + progress * 10) * s, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#ffffff';
        context.globalAlpha = fade * 0.7;
        context.beginPath();
        context.arc(effect.x, effect.y, (5 * (1 - progress) + 2) * s, 0, Math.PI * 2);
        context.fill();
      } else if (effect.kind === 'damageText') {
        const s = hexScale();
        const alpha = progress < 0.7 ? 1 : (1 - progress) / 0.3;
        const y = effect.y - progress * 18 * s;
        context.font = `bold ${Math.round(12 * s)}px system-ui, sans-serif`;
        context.textAlign = 'center';
        context.globalAlpha = alpha;
        context.shadowBlur = 0;
        context.lineWidth = 3;
        context.strokeStyle = 'rgba(0, 0, 0, 0.7)';
        context.strokeText?.(effect.text, effect.x, y);
        context.fillStyle = effect.color;
        context.fillText?.(effect.text, effect.x, y);
      }
      context.restore();
    }

    function drawEffects(context, now) {
      flushPendingHeals(now);
      for (const effect of effects) {
        drawEffect(context, effect, (now - effect.start) / effect.duration);
      }
    }

    function eachView(views, callback) {
      for (const view of views.values()) {
        if (view.alpha <= 0.01) continue;
        callback({ ...view.entity, hp: view.hp }, view);
      }
    }

    function forEachUnit(callback) {
      eachView(unitViews, callback);
    }

    function forEachHeadquarters(callback) {
      eachView(headquartersViews, callback);
    }

    function reset() {
      unitViews.clear();
      headquartersViews.clear();
      effects = [];
      attackFxPlayed.clear();
      pendingHealFx = [];
    }

    return {
      reset,
      syncState,
      recordEvent,
      update,
      forEachUnit,
      forEachHeadquarters,
      drawEffects,
      isActive,
      // 仅测试用：返回当前存活特效的 kind 列表。
      _debugEffects() {
        return effects.map(effect => effect.kind);
      },
    };
  }

  window.BoardAnimation = { create };
})();
