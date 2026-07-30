(() => {
  const EFFECT_LIMIT = 24;
  const POSITION_EASE = 0.2;
  const ALPHA_EASE = 0.16;
  const HP_EASE = 0.2;

  function create({ hexToPixel, ownerColor }) {
    const unitViews = new Map();
    const headquartersViews = new Map();
    let effects = [];

    function reducedMotion() {
      return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    }

    function safePixel(q, r) {
      if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
      const point = hexToPixel(q, r);
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
      return point;
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

    function controlPointPosition(state, id) {
      const point = state?.controlPoints?.get?.(id);
      return point ? safePixel(point.q, point.r) : null;
    }

    function recordEvent(event, state) {
      const payload = event?.payload || {};
      switch (event?.type) {
        case 'attack': {
          const from = entityPosition(payload.attackerId);
          const to = entityPosition(payload.targetId);
          if (!from || !to) break;
          addBeam(from, to, '#ff5c7a', 220);
          addRing(to, '#ff5c7a', 360, 1);
          addFlash(to, '#ff5c7a', 160);
          break;
        }
        case 'move':
          addRing(safePixel(payload.toQ, payload.toR), '#6ea8ff', 400, 0.8);
          break;
        case 'heal':
          addRing(entityPosition(payload.targetId), '#3effc8', 450, 1);
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
      return effects.length > 0 || viewMapIsActive(unitViews) || viewMapIsActive(headquartersViews);
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
      }
      context.restore();
    }

    function drawEffects(context, now) {
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
    };
  }

  window.BoardAnimation = { create };
})();
