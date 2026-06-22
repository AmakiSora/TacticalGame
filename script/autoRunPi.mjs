#!/usr/bin/env node
/**
 * 观战轮询游戏事件 GET /api/games/:id/events?after=<seq>
 * 无需 token，适合旁观者使用。
 *
 * 双向调度:
 *   - player_b 结束回合 -> 调用 player_a 的 pi
 *   - player_a 结束回合 -> 调用 player_b 的 pi
 *
 * 用法:
 *   node script/autoRunPi.mjs <game_id> [options]
 *
 * 选项:
 *   --a-session <path>      player_a 的 pi session 文件
 *   --b-session <path>      player_b 的 pi session 文件
 *   --a-model <model>       player_a 的模型 (默认 step-3.7-flash)
 *   --b-model <model>       player_b 的模型 (默认 step-3.7-flash)
 *   --a-provider <provider> player_a 的 pi provider (默认 new-api)
 *   --b-provider <provider> player_b 的 pi provider (默认 new-api)
 *   --a-prompt <text>       player_a 的提示语 (默认 "到你了")
 *   --b-prompt <text>       player_b 的提示语 (默认 "到你了")
 *   --provider <provider>   两侧默认 pi provider (默认 new-api, 被 --a/b-provider 覆盖)
 *   --skill <path>          pi skill 路径 (默认 .pi/skills/skill)
 *   --interval <sec>        轮询间隔 (默认 2)
 *   --timeout <sec>         等待对方结束回合的超时 (默认 10)
 *   --base-url <url>        服务地址 (默认 http://localhost:3100)
 *   --fresh                 忽略断点从头开始
 */

import process from "node:process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPiInvocation,
  fetchEvents,
  loadState,
  parseOptions,
  runPi,
  saveState,
  sleep,
  stateFilePath,
  ts,
} from "./autoRunPiCore.mjs";

const TURN_END = "turn_end";
const GAME_OVER = "game_over";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = dirname(SCRIPT_DIR);

const parsed = parseOptions(process.argv.slice(2));
if (!parsed.ok) {
  console.error(parsed.message);
  process.exit(1);
}

const options = parsed.options;
const stateFile = stateFilePath(options.gameId, SCRIPT_DIR);
const piA = buildPiInvocation({
  provider: options.aProvider,
  model: options.aModel,
  session: options.aSession,
  skill: options.skill,
  prompt: options.aPrompt,
});
const piB = buildPiInvocation({
  provider: options.bProvider,
  model: options.bModel,
  session: options.bSession,
  skill: options.skill,
  prompt: options.bPrompt,
});

function logEvent(turnNumber, ev) {
  const { type, seq, payload = {} } = ev;
  switch (type) {
    case "move":
      console.log(`[${ts()}] turn=${turnNumber} seq=${seq} 移动 ${payload.unitType ?? ""} -> (${payload.toQ},${payload.toR})`);
      break;
    case "attack":
      console.log(`[${ts()}] turn=${turnNumber} seq=${seq} 攻击 伤害=${payload.damage} 目标HP=${payload.targetHp}`);
      break;
    case "deploy":
      console.log(`[${ts()}] turn=${turnNumber} seq=${seq} 部署 ${payload.unitType} -> (${payload.q},${payload.r})`);
      break;
    case "heal":
      console.log(`[${ts()}] turn=${turnNumber} seq=${seq} 治疗 +${payload.amount}`);
      break;
    case "unit_death":
      console.log(`[${ts()}] turn=${turnNumber} seq=${seq} 阵亡 ${payload.type}`);
      break;
    case "control_point_captured":
      console.log(`[${ts()}] turn=${turnNumber} seq=${seq} 占领 ${payload.name} -> ${payload.owner}`);
      break;
    case "income":
      console.log(`[${ts()}] turn=${turnNumber} seq=${seq} ${payload.owner} 收入 +${payload.amount}`);
      break;
    default:
      console.log(`[${ts()}] turn=${turnNumber} seq=${seq} ${type}`);
  }
}

async function poll() {
  const { gameId, baseUrl, interval, timeout, fresh } = options;
  console.log(`[autoRunPi] 开始观战 game=${gameId}  url=${baseUrl}  interval=${interval}s  timeout=${timeout}s`);
  console.log(`[autoRunPi] 状态文件 ${stateFile}`);
  console.log("按 Ctrl+C 停止\n");

  const saved = loadState(stateFile, fresh);
  let lastSeq = saved?.lastSeq ?? 0;
  let turnNumber = saved?.turnNumber ?? 0;
  let triggeredASeq = new Set(saved?.triggeredASeq ?? []);
  let triggeredBSeq = new Set(saved?.triggeredBSeq ?? []);
  let deadlineA = null;
  let deadlineB = null;

  if (lastSeq > 0) {
    console.log(`[autoRunPi] 从断点恢复 lastSeq=${lastSeq} turn=${turnNumber}`);
  }

  function persist() {
    saveState(stateFile, {
      lastSeq,
      turnNumber,
      triggeredASeq: [...triggeredASeq],
      triggeredBSeq: [...triggeredBSeq],
    });
  }

  function triggerPiA() {
    runPi("player_a", piA, { cwd: PROJECT_DIR });
    deadlineA = Date.now() + timeout * 1000;
  }

  function triggerPiB() {
    runPi("player_b", piB, { cwd: PROJECT_DIR });
    deadlineB = Date.now() + timeout * 1000;
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (deadlineA && Date.now() > deadlineA) {
      console.log(`[${ts()}] ${timeout}s 内未检测到 player_a 结束回合，重试 A pi ...`);
      deadlineA = null;
      persist();
      triggerPiA();
      await sleep(0);
      continue;
    }
    if (deadlineB && Date.now() > deadlineB) {
      console.log(`[${ts()}] ${timeout}s 内未检测到 player_b 结束回合，重试 B pi ...`);
      deadlineB = null;
      persist();
      triggerPiB();
      await sleep(0);
      continue;
    }

    try {
      const events = await fetchEvents({ baseUrl, gameId, after: lastSeq });
      if (events.length === 0) {
        console.log(`[${ts()}] turn=${turnNumber} (等待新事件...)`);
      } else {
        for (const ev of events) {
          const { type, seq, payload = {} } = ev;
          lastSeq = seq;

          if (type === TURN_END) {
            turnNumber = payload.turnNumber;
            console.log(`[${ts()}] turn=${turnNumber} seq=${seq} 回合结束 -> ${payload.nextOwner}`);

            if (payload.previousOwner === "player_b") {
              deadlineB = null;
              if (!triggeredBSeq.has(seq)) {
                triggeredBSeq.add(seq);
                persist();
                triggerPiA();
              }
            } else if (payload.previousOwner === "player_a") {
              deadlineA = null;
              if (!triggeredASeq.has(seq)) {
                triggeredASeq.add(seq);
                persist();
                triggerPiB();
              }
            }
          } else if (type === GAME_OVER) {
            console.log(`[${ts()}] turn=${turnNumber} seq=${seq} 游戏结束`);
            persist();
            console.log("\n[autoRunPi] 游戏已结束，观战停止。");
            return;
          } else {
            logEvent(turnNumber, ev);
          }
        }
        persist();
      }
    } catch (err) {
      console.error(`[${ts()}] 请求失败: ${err.message}`);
    }

    await sleep(interval * 1000);
  }
}

poll().catch((err) => {
  console.error(`[autoRunPi] 未处理错误: ${err.stack ?? err.message}`);
  process.exit(1);
});
