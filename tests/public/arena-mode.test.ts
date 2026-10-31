import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('AI 竞技场按玩法模式分榜', () => {
  const html = readFileSync('public/arena.html', 'utf8');
  const source = readFileSync('public/arena.js', 'utf8');
  const statsSource = readFileSync('public/arena-stats.js', 'utf8');
  const data = JSON.parse(readFileSync('public/data/arena-leaderboard.json', 'utf8'));

  it('榜单与玩法统计都提供模式切换入口', () => {
    expect(html).toContain('id="mode-bar"');
    expect(html).toContain('id="rls-mode-bar"');
    expect(source).toContain('function populateModeBar');
    expect(statsSource).toContain('function renderModeBar');
    expect(source).toContain('各模式独立评分');
  });

  it('评估控制台在页面内提供控制令牌输入，不用再跑到对局页设置', () => {
    expect(html).toContain('id="eval-control-token"');
    expect(html).toContain('id="eval-save-token"');
    expect(html).toContain('id="eval-token-state"');
    expect(html).toContain('type="password"');
    expect(source).toContain('function syncControlTokenField');
    expect(source).toContain("localStorage.setItem('autoControlToken', value)");
    expect(source).toContain("localStorage.removeItem('autoControlToken')");
    expect(source).toContain("evalEl['eval-save-token'].addEventListener");
    // 保存后立即重查一次状态，不必等下一个 3s 轮询周期。
    expect(source).toMatch(/控制令牌已保存到本机浏览器[\s\S]{0,200}pollEvalStatus\(\);/);
  });

  it('评估控制台的维护任务（重算榜单/清空旧局）有独立进度条与日志区', () => {
    // 面板与跑批进度分开：维护任务的进度/日志不会覆盖跑批输出。
    for (const id of ['eval-task-panel', 'eval-task-title', 'eval-task-state', 'eval-task-fill', 'eval-task-text', 'eval-task-output']) {
      expect(html, `${id} 缺失`).toContain(`id="${id}"`);
    }
    expect(source).toContain('function renderEvalAuxTask');
    expect(source).toContain('renderEvalAuxTask(st.auxTask)');
    expect(source).toContain('task.outputTail');
    // 跑批进度条的填充元素必须带样式类：3.5.2 起它只有 id、没有 class，
    // 结果进度条一直是一条空轨道（维护任务面板另建的 fill 带了 class 才正常）。
    expect(html).toContain('<div id="eval-progress-fill" class="eval-progress-fill"></div>');
    // 没有确定进度时用流动条纹，避免启动/加载模型阶段看起来像卡住。
    expect(source).toContain("fill.classList.toggle('is-indeterminate', indeterminate)");
    expect(readFileSync('public/arena.css', 'utf8')).toContain('.eval-progress-fill.is-indeterminate');
    // 轮询自适应：跑批/维护任务运行时 1s，空闲 3s。
    expect(source).toContain('setTimeout(pollLoop, busy ? 1000 : 3000)');
    // 两个写操作都改走后台任务，完成前先给“已启动”，结果由状态轮询驱动。
    expect(source).toContain('榜单重算已启动，进度与日志见下方任务区');
    expect(source).toContain('清空旧局已启动，进度与日志见下方任务区');
    expect(source).toContain('维护任务运行中不许再点重算/清空');
  });

  it('榜单数据按模式分组，不再提供跨模式 all 总榜', () => {
    expect(data.maps).toBeUndefined();
    expect(Array.isArray(data.modes)).toBe(true);
    expect(data.modes.length).toBeGreaterThan(0);
    for (const mode of data.modes) {
      expect(mode).toHaveProperty('id');
      expect(mode).toHaveProperty('label');
      expect(mode.maps).toHaveProperty('all');
      expect(Array.isArray(mode.maps.all.models)).toBe(true);
    }
    const standard = data.modes.find((mode: { id: string }) => mode.id === 'standard');
    const simultaneous = data.modes.find((mode: { id: string }) => mode.id === 'simultaneous');
    const ids = (mode: any) => mode.maps.all.models.map((m: { id: string }) => m.id);
    expect(ids(standard)).not.toContain('algo_dest-prob@v2');
    if (simultaneous) expect(ids(simultaneous)).not.toContain('algo_threat@v1');
  });

  it('切模式时只使用当前模式的地图池与排名', () => {
    expect(source).toContain('return currentMode()?.maps?.[league] || null;');
    expect(source).toContain("Object.keys(current?.maps || {}).filter(key => key !== 'all')");
    expect(source).not.toContain('raw.maps[league]');
    expect(source).toContain('该模式暂无对局数据');
  });

  it('玩法统计从当前模式读取，避免跨模式混合聚合', () => {
    expect(statsSource).toContain('function currentGameplay');
    expect(statsSource).toContain('return currentMode()?.gameplay');
    expect(statsSource).toContain('renderModeBar()');
  });

  it('座位依赖散点图的说明文案与纵轴口径一致（纵轴是先手−后手胜率差）', () => {
    expect(html).toContain('纵轴=先手 − 后手胜率差');
    expect(html).not.toContain('纵轴=后手胜率');
    expect(statsSource).toContain("yLabel: '先手 − 后手胜率差'");
  });

  it('雷达图可清空选择、超上限有提示、配色不随勾选顺序漂移', () => {
    // 用户主动取消后不再自动回填默认选中。
    expect(statsSource).toContain('let radarTouched = false');
    expect(statsSource).toContain('radarTouched = true');
    expect(statsSource).toContain('if (!radarTouched && !radarPick.size)');
    // 上限 4：超限给文案提示而不是静默忽略。
    expect(statsSource).toContain('const RADAR_MAX = 4');
    expect(statsSource).toContain('最多同时对比');
    // 配色由候选顺序固定，而不是选中顺序。
    expect(statsSource).toContain('function radarColorMap');
    // 可点 chip 带 aria-pressed，读屏能感知选中状态。
    expect(statsSource).toContain('aria-pressed="');
  });

  it('地图静态指纹按新版 spawnSlots/layouts 生成，committed 产物不是旧脚本的 null 数据', () => {
    const fp = JSON.parse(readFileSync('public/data/arena-map-fingerprint.json', 'utf8'));
    expect(fp.maps.length).toBeGreaterThanOrEqual(10);
    for (const m of fp.maps) {
      if (m.error) continue;
      // 旧版脚本只认 headquarters/startingUnits，9/13 张图的 HQ 会解析成 null。
      expect(m.hq, `${m.id} 缺 HQ`).toEqual({ player_a: expect.any(Array), player_b: expect.any(Array) });
      expect(m.hqDistance, `${m.id} 缺 HQ 间距`).toEqual(expect.any(Number));
      expect(m.playableCellCount === null || Number.isInteger(m.playableCellCount)).toBe(true);
    }
  });

  it('增强数据源各自兜底：任一请求失败只让对应面板降级', () => {
    expect(statsSource).toContain(
      "fetch(`${LEADERBOARD_URL}?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null)",
    );
    expect(statsSource).toContain(
      "fetch(`${FINGERPRINT_URL}?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null)",
    );
    expect(statsSource).toContain('lbRes?.ok');
    expect(statsSource).toContain('fpRes?.ok');
  });

  it('评分榜与玩法画像都带「平均决策耗时」列，数据行携带 avgDecisionMs 字段', () => {
    expect(html).toContain('data-sort="avgDecisionMs"');
    expect(source).toContain('data-label="平均决策耗时"');
    expect(statsSource).toContain('data-label="平均决策耗时"');
    for (const mode of data.modes) {
      for (const m of mode.maps.all.models) {
        expect(m).toHaveProperty('avgDecisionMs');
      }
    }
  });

  it('评估控制台按模式切换地图与算法，并标明非标准模式只有算法参评', () => {
    expect(html).toContain('id="eval-modes"');
    expect(html).toContain('id="eval-mode-hint"');
    expect(source).toContain('function renderEvalModeBar');
    expect(source).toContain('modeCatalog');
    expect(source).toContain('currentEvalMaps');
    expect(source).toContain('evalAlgosForMode');
    // 四种模式均可跑批；非标准模式仅算法参评，算法不足 2 个时禁用启动并说明原因。
    expect(source).toContain('仅内置算法（RL 模型暂只支持标准模式）');
    expect(source).toContain('该模式至少需要选择 2 个参评算法');
    expect(source).toContain('等第二个算法落地后才能组批');
  });

  it('评估控制台提供「清空旧局」弹窗：范围筛选 + 试跑预览 + 确认后直接删除', () => {
    expect(html).toContain('id="eval-clear"');
    expect(source).toContain('window.UIDialog.open({');
    expect(source).toContain("title: '清空旧局并重新累积？'");
    expect(source).toContain("confirmText: '确认删除'");
    expect(source).toContain("tone: 'danger'");
    // 弹窗表单在 JS 里构建：模式/地图/参与者三项 + 试跑预览命中数。
    expect(source).toContain('data-clear="mode"');
    expect(source).toContain('data-clear="map"');
    expect(source).toContain('data-clear="participant"');
    expect(source).toContain('data-clear="preview"');
    expect(source).toContain('/api/arena/eval/clear-matches');
    expect(source).toContain('dryRun: true');
    expect(source).toContain('function describeClearScope');
    expect(source).toContain("evalEl['eval-clear'].disabled = st.status === 'running'");
  });
});
