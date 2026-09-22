/**
 * pi 扩展入口：把 pi 的事件接到 {@link PiHostAdapter}。
 *
 * 这里只做接线，不做决策——「要不要发、发什么」全在 `adapter.ts`，
 * 「失败怎么办」在 `client.ts`。这样换宿主（dsh）时只需要重写本文件。
 *
 * 事件 → 触发器对照（`litepet-adapter-ts` 的 `TRIGGER_SPECS`）：
 *
 * | pi 事件 | 触发器 | RPC |
 * |---|---|---|
 * | `session_start` | `onAttach` | `host/hello` + `daemon/info`（起心跳） |
 * | `agent_start` | `onSessionStart` | `agent/start` |
 * | `agent_end` | `onSessionEnd` | `agent/end`（`success` 由消息推出来，带 `note`） |
 * | `agent_settled` | `onSessionSettled` | `agent/settled`（**提醒只由这条触发**，带 `note`） |
 * | `tool_execution_start` | `onToolStart` | `tool/start` |
 * | `tool_execution_end` | `onToolEnd` | `tool/end` |
 * | `session_compact` / `..._failed` | `onBubble` | `pet/bubble` |
 * | `session_shutdown` | `onExit` | `host/bye` |
 */

import {
  VERSION,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { PiHostAdapter } from "./adapter.js";
import type { BubbleInput } from "litepet-adapter-ts";

import { TurnTracker, formatNote } from "./note.js";
import { deriveSuccess } from "./outcome.js";

/** 压缩原因 → 气泡文案。`manual` = 用户敲 `/compress`。 */
const COMPACT_BUBBLES: Readonly<Record<string, string>> = {
  manual: "上下文已压缩",
  threshold: "上下文自动压缩",
  overflow: "上下文溢出，已压缩",
};

/** 压缩气泡的兜底文案。 */
const COMPACT_BUBBLE_FALLBACK = "上下文已压缩";

/**
 * 扩展工厂。
 *
 * 按 pi 的要求，这里**不启动任何后台资源**（不建 socket、不起定时器）：
 * 心跳是在 `session_start` 里 attach 成功之后才起的。
 *
 * @param pi 扩展 API。
 */
export default function litepetExtension(pi: ExtensionAPI): void {
  const adapter = new PiHostAdapter();
  /** 这一轮的统计，只用来给通知凑一句正文。 */
  const turn = new TurnTracker();
  /** 最近一次推导出的成败，给 `agent_settled` 复用（它自己的事件里没有成败）。 */
  let lastSuccess = true;

  pi.on("session_start", async () => {
    await adapter.onAttach({
      host: adapter.host,
      agentVersion: VERSION,
      pid: process.pid,
    });
  });

  pi.on("agent_start", async (_event, ctx) => {
    turn.start(Date.now());
    await adapter.onSessionStart({ sessionId: sessionIdOf(ctx) });
  });

  pi.on("agent_end", async (event, ctx) => {
    lastSuccess = deriveSuccess(event.messages);
    await adapter.onSessionEnd({
      sessionId: sessionIdOf(ctx),
      success: lastSuccess,
      note: noteOf(turn, lastSuccess),
    });
  });

  pi.on("agent_settled", async (_event, ctx) => {
    await adapter.onSessionSettled({
      sessionId: sessionIdOf(ctx),
      note: noteOf(turn, lastSuccess),
    });
  });

  pi.on("tool_execution_start", async (event) => {
    turn.countTool();
    // 不传 bubble：文案交给宠物包的规则表插值，插件不替用户决定宠物说什么。
    await adapter.onToolStart({ toolName: event.toolName });
  });

  pi.on("tool_execution_end", async (event) => {
    if (event.isError) {
      turn.markToolFailed(event.toolName);
    }
    await adapter.onToolEnd({ toolName: event.toolName, isError: event.isError });
  });

  pi.on("session_compact", async (event) => {
    await adapter.onBubble(compactBubble(event.reason));
  });

  pi.on("session_compact_failed", async () => {
    await adapter.onBubble({ kind: "warning", text: "上下文压缩失败" });
  });

  pi.on("session_shutdown", async (event) => {
    await adapter.onExit({ reason: event.reason });
  });

  pi.registerCommand("litepet", {
    description: "查看 LitePet 桌面宠物的连接状态；`/litepet test` 弹一条测试气泡",
    handler: async (args, ctx) => {
      if (args.trim() === "test") {
        await adapter.onBubble({ kind: "status", text: "pi 适配器连通测试" });
        ctx.ui.notify("已请 LitePet 弹一条测试气泡", "info");
        return;
      }
      ctx.ui.notify(await formatStatus(adapter), "info");
    },
  });
}

/**
 * 会话 id；只用于 daemon 日志，取不到也不影响任何语义。
 *
 * @param ctx 事件上下文。
 * @returns 会话 id。
 */
function sessionIdOf(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionId();
}

/**
 * 取这一轮的通知正文。
 *
 * @param turn 记账器。
 * @param success 这一轮是不是成功。
 * @returns 正文；这一轮没开始过（没走过 `agent_start`）时给 `undefined`，
 *   让 daemon 回落到它自己的默认句。
 */
function noteOf(turn: TurnTracker, success: boolean): string | undefined {
  const facts = turn.snapshot(Date.now());
  return facts === null ? undefined : formatNote(facts, success);
}

/**
 * 压缩完成的气泡内容。
 *
 * @param reason `session_compact` 的原因。
 * @returns 气泡参数。
 */
function compactBubble(reason: string): BubbleInput {
  return { kind: "status", text: COMPACT_BUBBLES[reason] ?? COMPACT_BUBBLE_FALLBACK };
}

/**
 * 自检文案：把连接状态拼成给 `/litepet` 看的多行文本。
 *
 * @param adapter 适配器实例。
 * @returns 多行中文状态说明。
 */
async function formatStatus(adapter: PiHostAdapter): Promise<string> {
  const status = await adapter.getStatus();
  const lines: string[] = [
    status.attached
      ? `已连接 LitePet：宠物包 ${status.petId ?? "?"}，daemon ${status.daemonVersion ?? "?"}`
      : "未连接 LitePet",
    `端点文件：${status.endpointFile}（${status.endpointFound ? "已读到" : "读不到"}）`,
    `心跳：${status.heartbeatRunning ? `${status.pingIntervalMs ?? "?"} ms` : "未启动"}`,
  ];
  if (status.reconnects > 0) {
    lines.push(`daemon 重启后重连过 ${status.reconnects} 次`);
  }
  if (status.versionBlocked) {
    lines.push("协议版本不兼容，已停止发送事件");
  }
  if (status.lastFailure !== null) {
    lines.push(`最近失败：${status.lastFailure}`);
  }
  return lines.join("\n");
}
