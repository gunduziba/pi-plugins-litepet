/**
 * 10 个 RPC 方法的名字、参数与结果类型。
 *
 * 只有 3 个是**请求**（带 `id`、有应答）：`host/hello`、`daemon/ping`、`daemon/info`。
 * 其余 7 个全是**通知**（无 `id`、无响应体、无需 ack）——严禁把事件做成
 * 「发出去然后等 ack」的同步调用。
 */

import type { BubbleKindWire } from "./protocol.js";

/** 方法名常量。 */
export const Method = {
  /** 请求：登记宿主并索取协议版本。重复打招呼按「重连」处理，状态归零重来。 */
  HostHello: "host/hello",
  /** 通知：主动注销，不等 daemon 心跳超时。 */
  HostBye: "host/bye",
  /** 通知：一轮会话开始。 */
  AgentStart: "agent/start",
  /** 通知：一轮会话结束。 */
  AgentEnd: "agent/end",
  /**
   * 通知：agent **彻底**结束、不会再自动继续。
   *
   * 这是提醒（音效 / 系统通知 / 手机推送）的触发点；`agent/end` 不是。
   */
  AgentSettled: "agent/settled",
  /** 通知：工具调用开始。 */
  ToolStart: "tool/start",
  /** 通知：工具调用结束。 */
  ToolEnd: "tool/end",
  /** 通知：直接弹一条气泡。 */
  PetBubble: "pet/bubble",
  /** 请求：心跳，`ts` 原样回显。 */
  DaemonPing: "daemon/ping",
  /** 请求：查询 daemon 现状（调试与适配器自检用）。 */
  DaemonInfo: "daemon/info",
} as const;

/** 方法名取值类型。 */
export type MethodName = (typeof Method)[keyof typeof Method];

/** 需要应答的方法。 */
export type RequestMethod =
  | typeof Method.HostHello
  | typeof Method.DaemonPing
  | typeof Method.DaemonInfo;

/** 不需要应答的方法。 */
export type NotificationMethod = Exclude<MethodName, RequestMethod>;

/** 所有事件类参数都带宿主标识。 */
export interface HostScopedParams {
  /** 宿主标识，如 `pi` / `dsh`。 */
  readonly host: string;
}

/** `host/hello` 的参数。 */
export interface HostHelloParams extends HostScopedParams {
  /** 宿主进程号，仅用于日志。 */
  readonly pid?: number;
  /** 宿主 agent 版本，仅用于日志。 */
  readonly agentVersion?: string;
  /** 宿主客户端版本，仅用于日志。 */
  readonly clientVersion?: string;
  /** 声明的协议版本；缺省视为当前版本。高于 daemon 上限则回 `-32002`。 */
  readonly protocolVersion?: number;
}

/** `host/hello` 的结果。 */
export interface HostHelloResult {
  /** daemon 支持的协议版本。 */
  readonly protocolVersion: number;
  /** daemon 自身版本。 */
  readonly daemonVersion: string;
  /** 当前宠物包 id。 */
  readonly petId: string;
}

/** `host/bye` 的参数。 */
export interface HostByeParams extends HostScopedParams {
  /** 退出原因，仅用于日志。 */
  readonly reason?: string;
}

/** `agent/start` 的参数。 */
export interface AgentStartParams extends HostScopedParams {
  /** 会话 id，仅用于日志；daemon 不做多会话区分（每宿主一个状态机）。 */
  readonly sessionId?: string;
  /** 会话摘要，仅用于日志。 */
  readonly summary?: string;
}

/** `agent/end` 的参数。 */
export interface AgentEndParams extends HostScopedParams {
  /** 是否成功。 */
  readonly success: boolean;
  /** 会话 id，仅用于日志。 */
  readonly sessionId?: string;
  /** 为这条通知准备的一句话；连同 `agent/settled` 的 `note` 一起看。 */
  readonly note?: string;
}

/**
 * `agent/settled` 的参数。
 *
 * 语义是「**彻底**结束、不会再自动继续」，与 `agent/end` 的区别全在此：
 * 只要 agent 还会自己接着跑（自动继续、队列里还有后续消息），就还不算 settled。
 * 提醒层只认这条事件。
 */
export interface AgentSettledParams extends HostScopedParams {
  /** 会话 id，仅用于日志。 */
  readonly sessionId?: string;
  /**
   * 宿主为这条通知准备的一句话，如「改了三个文件，测试全绿」。
   *
   * 通知正文的来源链是「包里的 `alert.text` → 这条 `note` → 包里的气泡文字 →
   * 事件自带的一句话」，所以包作者写了 `alert.text` 时这里**不生效**；
   * 不写 `note` 也不会让通知变空。daemon 会把正文截到 120 字符以内。
   *
   * 它**不影响**屏幕上的动画与气泡，只进通知。
   */
  readonly note?: string;
}

/** `tool/start` 的参数。 */
export interface ToolStartParams extends HostScopedParams {
  /** 工具名。**同时用作气泡去重键**，不是展示文本。 */
  readonly toolName: string;
  /** 可选的展示文本；缺省时由规则表决定气泡文案。 */
  readonly bubble?: string;
}

/** `tool/end` 的参数。 */
export interface ToolEndParams extends HostScopedParams {
  /** 工具名。**这是去重键，必须与 `tool/start` 同一值**。 */
  readonly toolName: string;
  /** 是否出错。 */
  readonly isError?: boolean;
}

/** `pet/bubble` 的参数。 */
export interface PetBubbleParams extends HostScopedParams {
  /** 气泡类别；未知类别会被降级为最低优先级而不是报错。 */
  readonly kind: BubbleKindWire;
  /** 正文，超过 `BUBBLE_TEXT_LIMIT` 由 daemon 截断。 */
  readonly text: string;
  /** 存活时长（毫秒）；缺省 4000，越界会被 daemon 夹到 500—30000。 */
  readonly ttlMs?: number;
}

/** `daemon/ping` 的参数。 */
export interface DaemonPingParams extends HostScopedParams {
  /** 宿主本地时间戳（epoch ms），原样回显，用于估算时钟偏差。 */
  readonly ts?: number;
}

/** `daemon/ping` 的结果。 */
export interface DaemonPingResult {
  /** daemon 支持的协议版本。 */
  readonly protocolVersion: number;
  /** 宿主标识回显。 */
  readonly host: string;
  /** 请求里的 `ts` 原样回显。 */
  readonly ts: number | null;
}

/** `daemon/info` 的参数：空对象。 */
export type DaemonInfoParams = Record<string, never>;

/**
 * `daemon/info` 的结果。
 *
 * `pingIntervalMs` / `hostTimeoutMs` 由 daemon 当场报告，
 * **宿主不要在本地硬编码这两个值**。
 */
export interface DaemonInfoResult {
  /** daemon 支持的协议版本。 */
  readonly protocolVersion: number;
  /** daemon 自身版本。 */
  readonly daemonVersion: string;
  /** 当前宠物包 id。 */
  readonly petId: string;
  /** 已登记的宿主数量。 */
  readonly hostCount: number;
  /** 心跳间隔（毫秒），daemon 当前为 20000。 */
  readonly pingIntervalMs: number;
  /** 判宿主超时的阈值（毫秒），daemon 当前为 60000。 */
  readonly hostTimeoutMs: number;
}

/** 方法名 → 参数类型。 */
export interface MethodParams {
  readonly "host/hello": HostHelloParams;
  readonly "host/bye": HostByeParams;
  readonly "agent/start": AgentStartParams;
  readonly "agent/end": AgentEndParams;
  readonly "agent/settled": AgentSettledParams;
  readonly "tool/start": ToolStartParams;
  readonly "tool/end": ToolEndParams;
  readonly "pet/bubble": PetBubbleParams;
  readonly "daemon/ping": DaemonPingParams;
  readonly "daemon/info": DaemonInfoParams;
}

/** 请求方法 → 结果类型。通知方法没有结果。 */
export interface MethodResults {
  readonly "host/hello": HostHelloResult;
  readonly "daemon/ping": DaemonPingResult;
  readonly "daemon/info": DaemonInfoResult;
}

/**
 * 规则表里的事件名：点分形式，**与 JSON-RPC 方法名故意不同**。
 *
 * 包作者写的是「事件」，与线格式解耦，以后改传输层不用动宠物包。
 */
export type RuleEvent =
  | "agent.start"
  | "agent.end"
  | "agent.settled"
  | "tool.start"
  | "tool.end"
  | "bubble";

/** 规则事件 → 线格式方法名。 */
export interface RuleEventMethod {
  readonly "agent.start": typeof Method.AgentStart;
  readonly "agent.end": typeof Method.AgentEnd;
  readonly "agent.settled": typeof Method.AgentSettled;
  readonly "tool.start": typeof Method.ToolStart;
  readonly "tool.end": typeof Method.ToolEnd;
  readonly bubble: typeof Method.PetBubble;
}
