/**
 * 宿主侧契约：pi / dsh 各自把**本宿主的事件**接到这些触发器上。
 *
 * 本文件定义「有什么触发器、每个触发器该发哪个 RPC」，
 * 不含任何接线代码——那部分由各宿主自己写。
 *
 * 设计原则（`litepet` 的 `docs/PROTOCOL.md` §1）：
 * 适配器与 daemon 独立发版，所以宿主**只发语义，不发动画名**；
 * 「组 → 具体动画」由 daemon 用宠物包的规则表解析。
 */

import type { BubbleKindWire } from "./protocol.js";
import type { RuleEvent } from "./methods.js";

/**
 * 宿主标识。
 *
 * 建议用稳定短名（`pi` / `dsh`）——它会出现在 daemon 日志与气泡徽章里。
 */
export type HostId = "pi" | "dsh" | (string & {});

/** 宿主的会话/工具上下文由各宿主提供，这里只取公共字段。 */
export interface HostContext {
  /** 宿主标识。 */
  readonly host: HostId;
  /** 宿主 agent 版本，仅用于日志。 */
  readonly agentVersion?: string;
  /** 适配器自身版本，仅用于日志。 */
  readonly clientVersion?: string;
  /** 宿主进程号，仅用于日志。 */
  readonly pid?: number;
}

/** 一轮会话开始。 */
export interface SessionStartInput {
  /** 会话 id，仅用于日志。 */
  readonly sessionId?: string;
  /** 会话摘要，仅用于日志。 */
  readonly summary?: string;
}

/** 一轮会话结束。 */
export interface SessionEndInput {
  /** 会话 id，仅用于日志。 */
  readonly sessionId?: string;
  /** 是否成功。 */
  readonly success: boolean;
  /** 为这条通知准备的一句话；见 `SessionSettledInput.note`。 */
  readonly note?: string;
}

/**
 * 一轮会话**彻底**结束，不会再自动继续。
 *
 * 与 `SessionEndInput` 的区别就是「还会不会自己接着跑」：
 * 只要 agent 会继续下一轮（自动继续、队列里还有后续消息），就还不算 settled。
 * 提醒（音效 / 系统通知 / 推送）只由这一条触发。
 */
export interface SessionSettledInput {
  /** 会话 id，仅用于日志。 */
  readonly sessionId?: string;
  /**
   * 为这条通知准备的一句话：包里的 `alert.text` 缺席时，它就是通知正文。
   *
   * 提醒是给人看的，所以这句话应该带上「这一轮到底发生了什么」，
   * 而不是重写一遍包里的通用文案。缺省不发时通知仍然会出现，
   * 只是正文换成事件自带的那一句（如「本轮会话结束」）。
   */
  readonly note?: string;
}

/** 工具调用开始。 */
export interface ToolStartInput {
  /**
   * 工具名。**用稳定的机器名，不要用人类可读标题**——
   * 它同时是 daemon 的气泡去重键，也是规则表 `on: "tool.start"` 的匹配对象。
   */
  readonly toolName: string;
  /** 可选展示文本；缺省由规则表决定气泡文案。 */
  readonly bubble?: string;
}

/** 工具调用结束。 */
export interface ToolEndInput {
  /** 工具名，**必须与对应 `tool/start` 是同一个值**，否则去重键对不上。 */
  readonly toolName: string;
  /** 是否出错。 */
  readonly isError?: boolean;
}

/** 直接弹一条气泡。 */
export interface BubbleInput {
  /** 类别；未知类别会被降级为最低优先级，不会报错。 */
  readonly kind: BubbleKindWire;
  /** 正文。 */
  readonly text: string;
  /** 存活时长（毫秒），缺省 4000。 */
  readonly ttlMs?: number;
}

/** 心跳。 */
export interface HeartbeatInput {
  /** 本地时间戳（epoch ms），daemon 原样回显。 */
  readonly ts?: number;
}

/** 主动退出。 */
export interface ExitInput {
  /** 退出原因，仅用于日志。 */
  readonly reason?: string;
}

/**
 * 宿主必须实现的生命周期面。
 *
 * 前 6 个（会话、工具、气泡）与宠物包的规则表事件一一对应；
 * `onHeartbeat` 与 `onExit` 是连接维护，与宠物语义无关。
 *
 * **全部允许返回 `Promise` 且返回值被忽略**：宠物状态不该阻塞宿主主流程，
 * 实现方可以 fire-and-forget，但必须自己吞掉传输错误（见 `README.md` 的容错要求）。
 */
export interface HostAdapter {
  /** 宿主标识。 */
  readonly host: HostId;

  /** 接入 daemon 并登记宿主（对应 `host/hello`）。 */
  onAttach(context: HostContext): Promise<void> | void;

  /** 一轮会话开始（对应 `agent/start`）。 */
  onSessionStart(input: SessionStartInput): Promise<void> | void;

  /** 一轮会话结束（对应 `agent/end`）。 */
  onSessionEnd(input: SessionEndInput): Promise<void> | void;

  /**
   * 一轮会话彻底结束、不会再自动继续（对应 `agent/settled`）。
   *
   * **提醒只由这一条触发**：`onSessionEnd` 每轮都会发生（pi 会自动继续），
   * 拿它当提醒点会每一轮都响。宿主没有「确定结束」信号时**不要用
   * `onSessionEnd` 顶替**，显式记录为不支持即可（只是少一条提醒，不会播错）。
   */
  onSessionSettled(input: SessionSettledInput): Promise<void> | void;

  /** 工具调用开始（对应 `tool/start`）。 */
  onToolStart(input: ToolStartInput): Promise<void> | void;

  /** 工具调用结束（对应 `tool/end`）。 */
  onToolEnd(input: ToolEndInput): Promise<void> | void;

  /** 直接弹气泡（对应 `pet/bubble`）。 */
  onBubble(input: BubbleInput): Promise<void> | void;

  /** 心跳（对应 `daemon/ping`）；间隔从 `daemon/info` 的 `pingIntervalMs` 读。 */
  onHeartbeat(input: HeartbeatInput): Promise<void> | void;

  /** 主动注销（对应 `host/bye`）；不发也能靠超时回收，但会拖慢宠物反应。 */
  onExit(input: ExitInput): Promise<void> | void;
}

/** 规则事件 → 宿主回调名。 */
export interface RuleEventTrigger {
  readonly "agent.start": "onSessionStart";
  readonly "agent.end": "onSessionEnd";
  readonly "agent.settled": "onSessionSettled";
  readonly "tool.start": "onToolStart";
  readonly "tool.end": "onToolEnd";
  readonly bubble: "onBubble";
}

/** 兜底断言：规则事件都能在 `HostAdapter` 上找到对应回调。 */
export type RuleEventIsCovered = RuleEvent extends keyof RuleEventTrigger ? true : never;

/** 宿主回调名取值。 */
export type TriggerName = RuleEventTrigger[keyof RuleEventTrigger];

/**
 * 每个触发器的语义说明，供适配器作者对照填写。
 *
 * **这是文档而不是可执行代码**：把它当作「接线清单」，
 * 逐条确认宿主事件库里有对应钩子，缺哪个就显式记录为不支持。
 */
export interface TriggerSpec {
  /** 对应的 RPC 方法。 */
  readonly method: string;
  /** 是请求还是通知。 */
  readonly kind: "request" | "notification";
  /** 该在宿主的哪个时机触发。 */
  readonly when: string;
  /** 拿不到信息时怎么办。 */
  readonly fallback: string;
}
