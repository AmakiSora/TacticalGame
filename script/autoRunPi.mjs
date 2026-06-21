#!/usr/bin/env node
/**
 * 观战轮询游戏事件 GET /api/games/:id/events?after=<seq>
 * 无需 token，适合旁观者使用。
 *
 * 双向调度:
 *   - player_b 结束回合 → 调用 player_a 的 pi
 *   - player_a 结束回合 → 调用 player_b 的 pi
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
 *   --provider <provider>   两侧默认 pi provider (默认 new-api,被 --a/b-provider 覆盖)
 *   --skill <path>          pi skill 路径 (默认 .pi/skills/skill)
 *   --interval <sec>        轮询间隔 (默认 2)
 *   --timeout <sec>         等待对方结束回合的超时 (默认 10)
 *   --base-url <url>        服务地址 (默认 http://localhost:3100)
 *   --fresh                 忽略断点从头开始
 */

import process from "node:process";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);

function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}

const gameId = args.find((a) => !a.startsWith("--"));
const interval = Number(getArg("--interval")) || 2;
const timeout = Number(getArg("--timeout")) || 10;
const baseUrl = getArg("--base-url") || "http://localhost:3100";
const fresh = args.includes("--fresh");

// pi 命令公共部分
const defaultProvider = getArg("--provider") || "new-api";
const skill = getArg("--skill") || ".pi/skills/skill";

// player_a / player_b 各自的 session / model / provider / prompt
const aSession = getArg("--a-session");
const bSession = getArg("--b-session");
const aModel = getArg("--a-model") || "step-3.7-flash";
const bModel = getArg("--b-model") || "step-3.7-flash";
const aProvider = getArg("--a-provider") || defaultProvider;
const bProvider = getArg("--b-provider") || defaultProvider;
const aPrompt = getArg("--a-prompt") || "到你了";
const bPrompt = getArg("--b-prompt") || "到你了";

if (!gameId) {
  console.error("用法: node script/autoRunPi.mjs <game_id> --a-session <path> --b-session <path> [options]");
  process.exit(1);
}

if (!aSession || !bSession) {
  console.error("错误: 必须通过 --a-session 和 --b-session 指定两侧的 pi session 文件");
  process.exit(1);
}

const TURN_END = "turn_end";
const GAME_OVER = "game_over";

// player_a 的 pi 命令(B 结束回合时调用)
const PI_CMD_A = `pi --provider ${aProvider} --model ${aModel} --session "${aSession}" --skill ${skill} -p "${aPrompt}"`;
// player_b 的 pi 命令(A 结束回合时调用)
const PI_CMD_B = `pi --provider ${bProvider} --model ${bModel} --session "${bSession}" --skill ${skill} -p "${bPrompt}"`;

// 断点续传状态文件
const STATE_FILE = fileURLToPath(new URL(`.autoRun-${gameId}.json`, import.meta.url));

function loadState() {
  if (fresh) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state));
}

async function fetchEvents(after = 0) {
  const url = `${baseUrl}/api/games/${gameId}/events?after=${after}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return body.events ?? [];
}

function ts() {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

async function poll() {
  console.log(`[autoRunPi] 开始观战 game=${gameId}  url=${baseUrl}  interval=${interval}s  timeout=${timeout}s`);
  console.log("按 Ctrl+C 停止\n");

  // 断点续传:避免重放历史 turn_end 反复触发 pi
  const saved = loadState();
  let lastSeq = saved?.lastSeq ?? 0;
  let turnNumber = saved?.turnNumber ?? 0;
  // 已触发 pi 的回合序号集合,防止重启后重复触发
  let triggeredASeq = new Set(saved?.triggeredASeq ?? []); // A 结束 → 已调用 B pi
  let triggeredBSeq = new Set(saved?.triggeredBSeq ?? []); // B 结束 → 已调用 A pi
  // deadline: 等待对应玩家结束回合的截止时间戳(ms)
  let deadlineA = null; // 已触发 A 的 pi,等待 A 结束回合
  let deadlineB = null; // 已触发 B 的 pi,等待 B 结束回合

  if (lastSeq > 0) {
    console.log(`[autoRunPi] 从断点恢复 lastSeq=${lastSeq} turn=${turnNumber}`);
  }

  function runPiA() {
    console.log(`[${ts()}] 执行 player_a pi ...`);
    execSync(PI_CMD_A, { stdio: "inherit", cwd: new URL("..", import.meta.url) });
  }

  function runPiB() {
    console.log(`[${ts()}] 执行 player_b pi ...`);
    execSync(PI_CMD_B, { stdio: "inherit", cwd: new URL("..", import.meta.url) });
  }

  function persist() {
    saveState({
      lastSeq, turnNumber,
      triggeredASeq: [...triggeredASeq],
      triggeredBSeq: [...triggeredBSeq],
    });
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // 超时检查:触发 pi 后玩家没在 timeout 内结束回合 → 重试
    if (deadlineA && Date.now() > deadlineA) {
      console.log(`[${ts()}] ⚠️ ${timeout}s 内未检测到 player_a 结束回合，重试 A pi ...`);
      deadlineA = null;
      persist();
      runPiA();
      deadlineA = Date.now() + timeout * 1000;
      continue;
    }
    if (deadlineB && Date.now() > deadlineB) {
      console.log(`[${ts()}] ⚠️ ${timeout}s 内未检测到 player_b 结束回合，重试 B pi ...`);
      deadlineB = null;
      persist();
      runPiB();
      deadlineB = Date.now() + timeout * 1000;
      continue;
    }

    try {
      const events = await fetchEvents(lastSeq);
      if (events.length === 0) {
        console.log(`[${ts()}] turn=${turnNumber} (等待新事件...)`);
      } else {
        for (const ev of events) {
          const { type, seq } = ev;
          lastSeq = seq;

          switch (type) {
            case "move":
              console.log(`[${ts()}] turn=${turnNumber} seq=${seq} 移动 ${ev.payload.unitType ?? ""} → (${ev.payload.toQ},${ev.payload.toR})`);
              break;
            case "attack":
              console.log(`[${ts()}] turn=${turnNumber} seq=${seq} 攻击 伤害=${ev.payload.damage} 目标HP=${ev.payload.targetHp}`);
              break;
            case "deploy":
              console.log(`[${ts()}] turn=${turnNumber} seq=${seq} 部署 ${ev.payload.unitType} → (${ev.payload.q},${ev.payload.r})`);
              break;
            case "heal":
              console.log(`[${ts()}] turn=${turnNumber} seq=${seq} 治疗 +${ev.payload.amount}`);
              break;
            case "unit_death":
              console.log(`[${ts()}] turn=${turnNumber} seq=${seq} 💀 阵亡 ${ev.payload.type}`);
              break;
            case "control_point_captured":
              console.log(`[${ts()}] turn=${turnNumber} seq=${seq} 🏳️ 占领 ${ev.payload.name} → ${ev.payload.owner}`);
              break;
            case "income":
              console.log(`[${ts()}] turn=${turnNumber} seq=${seq} 💰 ${ev.payload.owner} 收入 +${ev.payload.amount}`);
              break;
            case TURN_END:
              turnNumber = ev.payload.turnNumber;
              console.log(`[${ts()}] turn=${turnNumber} seq=${seq} 🔄 回合结束 → ${ev.payload.nextOwner}`);
              if (ev.payload.previousOwner === "player_b") {
                // B 结束 → 调用 A 的 pi(同一 B 回合只触发一次)
                if (!triggeredBSeq.has(seq)) {
                  triggeredBSeq.add(seq);
                  persist();
                  runPiA();
                  deadlineA = Date.now() + timeout * 1000;
                }
              } else if (ev.payload.previousOwner === "player_a") {
                // A 结束 → 调用 B 的 pi(同一 A 回合只触发一次)
                if (!triggeredASeq.has(seq)) {
                  triggeredASeq.add(seq);
                  persist();
                  runPiB();
                  deadlineB = Date.now() + timeout * 1000;
                }
              }
              // 收到对应玩家的回合结束 → 取消该侧超时
              if (ev.payload.previousOwner === "player_a") deadlineA = null;
              if (ev.payload.previousOwner === "player_b") deadlineB = null;
              break;
            case GAME_OVER:
              console.log(`[${ts()}] turn=${turnNumber} seq=${seq} 🏁 游戏结束`);
              console.log("\n[autoRunPi] 游戏已结束，观战停止。");
              return;
            default:
              console.log(`[${ts()}] turn=${turnNumber} seq=${seq} ${type}`);
          }
        }
        persist();
      }
    } catch (err) {
      console.error(`[${ts()}] 请求失败: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, interval * 1000));
  }
}

poll();
