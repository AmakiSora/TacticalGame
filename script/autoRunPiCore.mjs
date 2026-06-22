import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_BASE_URL = "http://localhost:3100";
export const DEFAULT_INTERVAL_SECONDS = 2;
export const DEFAULT_TIMEOUT_SECONDS = 10;
export const DEFAULT_PROVIDER = "new-api";
export const DEFAULT_MODEL = "step-3.7-flash";
export const DEFAULT_PROMPT = "到你了";
export const DEFAULT_SKILL = ".pi/skills/skill";
const VALUE_FLAGS = new Set([
  "--a-session",
  "--b-session",
  "--a-model",
  "--b-model",
  "--a-provider",
  "--b-provider",
  "--a-prompt",
  "--b-prompt",
  "--provider",
  "--skill",
  "--interval",
  "--timeout",
  "--base-url",
]);

export function getArg(args, flag) {
  const i = args.indexOf(flag);
  if (i === -1) return null;
  const value = args[i + 1];
  return value && !value.startsWith("--") ? value : null;
}

function getGameId(args) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (VALUE_FLAGS.has(arg)) {
      i += 1;
      continue;
    }
    if (!arg.startsWith("--")) return arg;
  }
  return null;
}

function parsePositiveNumber(value, fallback, name) {
  if (value == null) return { ok: true, value: fallback };
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { ok: false, message: `错误: ${name} 必须是正数` };
  }
  return { ok: true, value: parsed };
}

export function parseOptions(args) {
  for (const flag of VALUE_FLAGS) {
    const i = args.indexOf(flag);
    if (i !== -1 && (!args[i + 1] || args[i + 1].startsWith("--"))) {
      return { ok: false, message: `错误: ${flag} 需要一个值` };
    }
  }

  const gameId = getGameId(args);
  if (!gameId) {
    return {
      ok: false,
      message: "用法: node script/autoRunPi.mjs <game_id> --a-session <path> --b-session <path> [options]",
    };
  }

  const interval = parsePositiveNumber(getArg(args, "--interval"), DEFAULT_INTERVAL_SECONDS, "--interval");
  if (!interval.ok) return interval;
  const timeout = parsePositiveNumber(getArg(args, "--timeout"), DEFAULT_TIMEOUT_SECONDS, "--timeout");
  if (!timeout.ok) return timeout;

  const aSession = getArg(args, "--a-session");
  const bSession = getArg(args, "--b-session");
  if (!aSession || !bSession) {
    return { ok: false, message: "错误: 必须通过 --a-session 和 --b-session 指定两侧的 pi session 文件" };
  }

  const defaultProvider = getArg(args, "--provider") || DEFAULT_PROVIDER;
  return {
    ok: true,
    options: {
      gameId,
      interval: interval.value,
      timeout: timeout.value,
      baseUrl: getArg(args, "--base-url") || DEFAULT_BASE_URL,
      fresh: args.includes("--fresh"),
      skill: getArg(args, "--skill") || DEFAULT_SKILL,
      aSession,
      bSession,
      aModel: getArg(args, "--a-model") || DEFAULT_MODEL,
      bModel: getArg(args, "--b-model") || DEFAULT_MODEL,
      aProvider: getArg(args, "--a-provider") || defaultProvider,
      bProvider: getArg(args, "--b-provider") || defaultProvider,
      aPrompt: getArg(args, "--a-prompt") || DEFAULT_PROMPT,
      bPrompt: getArg(args, "--b-prompt") || DEFAULT_PROMPT,
    },
  };
}

export function buildPiInvocation({ provider, model, session, skill, prompt }) {
  return {
    command: "pi",
    args: [
      "--provider", provider,
      "--model", model,
      "--session", session,
      "--skill", skill,
      "-p", prompt,
    ],
  };
}

export function stateFilePath(gameId, scriptDir) {
  const safeGameId = String(gameId).replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(scriptDir, `.autoRun-${safeGameId}.json`).replaceAll("\\", "/");
}

export function loadState(stateFile, fresh = false) {
  if (fresh) return null;
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
}

export function saveState(stateFile, state) {
  writeFileSync(stateFile, `${JSON.stringify(state)}\n`);
}

export function ts() {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolvePiInvocation(invocation) {
  const npmPrefix = process.env.APPDATA ? join(process.env.APPDATA, "npm") : null;
  const piCli = npmPrefix ? join(npmPrefix, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js") : null;
  if (piCli && existsSync(piCli)) {
    return { command: process.execPath, args: [piCli, ...invocation.args] };
  }
  return invocation;
}

export function runPi(label, invocation, deps = {}) {
  const runner = deps.spawnSync ?? spawnSync;
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const cwd = deps.cwd ?? dirname(dirname(fileURLToPath(import.meta.url)));
  const resolved = resolvePiInvocation(invocation);

  log(`[${ts()}] 执行 ${label} pi ...`);
  const result = runner(resolved.command, resolved.args, {
    cwd,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    error(`[${ts()}] ${label} pi 启动失败: ${result.error.message}`);
    return false;
  }
  if (result.status !== 0) {
    error(`[${ts()}] ${label} pi 退出码 ${result.status}`);
    return false;
  }
  return true;
}

export async function fetchEvents({ baseUrl, gameId, after = 0, fetchImpl = fetch }) {
  const url = `${baseUrl}/api/games/${encodeURIComponent(gameId)}/events?after=${after}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return body.events ?? [];
}
