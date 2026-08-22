import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('simultaneous mode UI', () => {
  const replayClients = [
    'public/play.js',
    'public/play-m.js',
    'public/app.js',
    'public/spectator-m.js',
    'public/spectator2.html',
  ];
  const playerClients = ['public/play.js', 'public/play-m.js'];

  it('replays plan/round events on every board and labels attack misses', () => {
    for (const file of replayClients) {
      const source = read(file);
      expect(source).toContain("case 'round_start'");
      expect(source).toContain("case 'plan_committed'");
      expect(source).toContain("case 'round_resolved'");
      expect(source).toContain("case 'action_failed'");
      expect(source).toContain('p.hit === false');
    }
  });

  it('gates player interactions on the planning window in simultaneous mode', () => {
    for (const file of playerClients) {
      const source = read(file);
      expect(source).toContain('function canActNow()');
      expect(source).toContain("gameConfig?.mode === 'simultaneous'");
      expect(source).toContain('function unitHasPlannedAction(unitId)');
      expect(source).toContain('plannedAlready');
      expect(source).toContain("state.players?.[myPlayer]?.status === 'active' && !iCommitted()");
    }
  });

  it('queues instead of executing: attack targets cells and every action reports queued', () => {
    for (const file of playerClients) {
      const source = read(file);
      // 桌面端点击变量为 hoverCell，移动端为 cell。
      const attackCellBody = file.includes('play-m.')
        ? '{ attackerId: selectedUnitId, q: cell.q, r: cell.r }'
        : '{ attackerId: selectedUnitId, q: hoverCell.q, r: hoverCell.r }';
      expect(source).toContain(attackCellBody);
      expect(source).toContain("isSimultaneous() && hit?.type === 'attack-radius'");
      expect(source).toContain('指令已入队');
    }
  });

  it('renders the plan queue panel with revoke support and commit status', () => {
    for (const file of playerClients) {
      const source = read(file);
      expect(source).toContain('function renderPlanPanel()');
      expect(source).toContain('function describePlanAction(a)');
      expect(source).toContain('/plan/revoke');
      expect(source).toContain('plan-revoke');
      expect(source).toContain("'确认行动'");
      expect(source).toContain('myPlanQueue()');
      expect(source).toContain('committedList()');
    }
    expect(read('public/play.html')).toContain('id="plan-panel"');
    expect(read('public/play-m.html')).toContain('id="plan-panel"');
    expect(read('public/play.css')).toContain('.plan-revoke');
    expect(read('public/play-m.css')).toContain('.plan-revoke');
  });

  it('merges the sanitized server plan state into the local event state', () => {
    for (const file of playerClients) {
      const source = read(file);
      expect(source).toContain('data.plan.myQueue');
      expect(source).toContain('data.plan.committed');
      expect(source).toContain("gameConfig?.mode === 'simultaneous' ? null : (p.firstPlayer || s.turn.turnOrder[0] || null)");
    }
  });

  it('labels the simultaneous map in the map picker', () => {
    for (const file of playerClients) {
      const source = read(file);
      expect(source).toContain("map.preview?.mode === 'simultaneous' ? '同时'");
      expect(source).toContain("map.preview?.mode === 'annihilation' ? '歼灭' : '标准'");
    }
  });

  it('documents the simultaneous flow in the player hints', () => {
    const html = read('public/play.html');
    expect(html).toContain('同时模式');
    expect(html).toContain('统一同时结算');
  });
});
