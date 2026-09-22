/**
 * `HostAdapter` 的 pi 侧实现。
 *
 * 三条硬规矩（`litepet-adapter-ts/README.md` 的容错要求）：
 * 1. **任何失败都不许冒泡到宿主**：每种宠物动作都是「尽力而为」，抛出去就是
 *    让桌面宠物把 pi 的会话搞崩。
 * 2. **daemon 不在时不无限重试**：读端点失败按指数退避重试，几次之后彻底放弃，
 *    直到下一次 `session_start` 才重新给机会。
 * 3. **协议版本不支持就闭嘴**：宁可什么都不发，也不要让 daemon 收到读不懂的事件。
 *
 * 生命周期：`session_start` 时 hello，`session_shutdown` 时 bye。
 * 中途 daemon 重启（心跳请求回 `HostUnknown`）会就地重新 hello。
 */

import {
  ErrorCode,
  Method,
  PROTOCOL_VERSION,
  type BubbleInput,
  type DaemonInfoResult,
  type ExitInput,
  type HeartbeatInput,
  type HostAdapter,
  type HostContext,
  type HostHelloResult,
  type HostId,
  type MethodParams,
  type NotificationMethod,
  type SessionEndInput,
  type SessionSettledInput,
  type SessionStartInput,
  type ToolEndInput,
  type ToolStartInput,
} from "litepet-adapter-ts";

import { HttpLitePetClient, isRpcFailure } from "./client.js";
import { locateEndpoint, readEndpoint } from "./endpoint.js";

/** 端点读不动的最大连续尝试次数；超过就放弃，等下一次 `session_start` 重置。 */
export const MAX_ENDPOINT_ATTEMPTS = 5;

/** 端点重试的首次间隔（毫秒）。 */
const RETRY_BASE_MS = 1000;

/** 端点重试的间隔上限（毫秒）。 */
const RETRY_MAX_MS = 60_000;

/** `daemon/info` 要不到时的兜底心跳间隔（毫秒），与 daemon 当前实现同值。 */
const FALLBACK_PING_INTERVAL_MS = 20_000;

/**
 * 对外自检快照：给 `/litepet` 命令看「为什么没反应」。
 *
 * 全是只读的当场取值，不做缓存。
 */
export interface AdapterStatus {
  /** `daemon.json` 的完整路径。 */
  readonly endpointFile: string;
  /** 端点文件这次读到了没有。 */
  readonly endpointFound: boolean;
  /** 连上并 `host/hello` 过了没有。 */
  readonly attached: boolean;
  /** daemon 自报版本；没连上时缺省。 */
  readonly daemonVersion?: string;
  /** 当前宠物包 id；没连上时缺省。 */
  readonly petId?: string;
  /** daemon 心跳间隔（毫秒）；没连上时缺省。 */
  readonly pingIntervalMs?: number;
  /** 心跳定时器在不在跑。 */
  readonly heartbeatRunning: boolean;
  /** 因协议版本不兼容而停机了没有。 */
  readonly versionBlocked: boolean;
  /** daemon 重启后重新登记过几次。 */
  readonly reconnects: number;
  /** 最近一次失败的说明；一切正常时为 `null`。 */
  readonly lastFailure: string | null;
}

/**
 * pi 的事件 → LitePet daemon 的触发器。
 *
 * 实例本身不含定时器：心跳在 `onAttach` 之后才起，`onExit` 里清掉。
 * 这样 pi 的扩展工厂只 new 一个对象、不启动任何后台资源。
 */
export class PiHostAdapter implements HostAdapter {
  /** 宿主标识；出现在 daemon 日志与气泡徽章里。 */
  readonly host: HostId = "pi";

  #context: HostContext | null = null;
  #client: HttpLitePetClient | null = null;
  #attached = false;
  #versionBlocked = false;
  #endpointAttempts = 0;
  #nextEndpointAttemptAt = 0;
  #heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  #helloResult: HostHelloResult | null = null;
  #pingIntervalMs = FALLBACK_PING_INTERVAL_MS;
  #lastFailure: string | null = null;
  #reconnects = 0;

  /**
   * 接入 daemon：读端点、`host/hello`、按 `daemon/info` 起心跳。
   *
   * @param context 宿主上下文（pid / agent 版本等，仅用于日志）。
   */
  async onAttach(context: HostContext): Promise<void> {
    this.#context = context;
    this.#endpointAttempts = 0;
    this.#nextEndpointAttemptAt = 0;
    if (this.#versionBlocked) {
      return;
    }
    const client = await this.#resolveClient();
    if (client === null) {
      return;
    }
    await this.#register(client);
  }

  /** 一轮会话开始 → `agent/start`。 */
  async onSessionStart(input: SessionStartInput): Promise<void> {
    await this.#notify(Method.AgentStart, { host: this.host, sessionId: input.sessionId });
  }

  /**
   * 一轮会话结束 → `agent/end`。
   *
   * `success` 由调用方从 `agent_end` 的消息里推出来（见 `outcome.ts`）。
   */
  async onSessionEnd(input: SessionEndInput): Promise<void> {
    await this.#notify(Method.AgentEnd, {
      host: this.host,
      sessionId: input.sessionId,
      success: input.success,
    });
  }

  /**
   * 彻底结束 → `agent/settled`。
   *
   * 提醒（音效 / 系统通知 / 推送）只由这一条触发，所以**必须**是 pi 的
   * `agent_settled`，不能拿 `agent_end` 顶替。
   */
  async onSessionSettled(input: SessionSettledInput): Promise<void> {
    await this.#notify(Method.AgentSettled, { host: this.host, sessionId: input.sessionId });
  }

  /** 工具调用开始 → `tool/start`。气泡文案交给 daemon 的规则表。 */
  async onToolStart(input: ToolStartInput): Promise<void> {
    await this.#notify(Method.ToolStart, {
      host: this.host,
      toolName: input.toolName,
      bubble: input.bubble,
    });
  }

  /** 工具调用结束 → `tool/end`。`toolName` 必须与上面那次完全相同。 */
  async onToolEnd(input: ToolEndInput): Promise<void> {
    await this.#notify(Method.ToolEnd, {
      host: this.host,
      toolName: input.toolName,
      isError: input.isError,
    });
  }

  /** 直接弹一条气泡 → `pet/bubble`。 */
  async onBubble(input: BubbleInput): Promise<void> {
    await this.#notify(Method.PetBubble, {
      host: this.host,
      kind: input.kind,
      text: input.text,
      ttlMs: input.ttlMs,
    });
  }

  /** 心跳 → `daemon/ping`。间隔由 `daemon/info` 现场给。 */
  async onHeartbeat(input: HeartbeatInput): Promise<void> {
    const client = this.#client;
    if (client === null || !this.#attached) {
      return;
    }
    try {
      await client.request(Method.DaemonPing, { host: this.host, ts: input.ts });
    } catch (error) {
      await this.#handleRequestFailure("daemon/ping", error);
    }
  }

  /** 注销 → `host/bye`，并停表。 */
  async onExit(input: ExitInput): Promise<void> {
    const client = this.#client;
    this.#stopHeartbeat();
    this.#attached = false;
    this.#helloResult = null;
    if (client === null) {
      return;
    }
    try {
      await client.notify(Method.HostBye, { host: this.host, reason: input.reason });
    } catch {
      // 注销失败无需处理：daemon 会按心跳超时自己回收。
    } finally {
      this.#client = null;
    }
  }

  /**
   * 自检快照。
   *
   * @returns 当前连接状态与最近一次失败原因。
   */
  async getStatus(): Promise<AdapterStatus> {
    const { endpointFile } = locateEndpoint();
    const endpoint = await readEndpoint();
    const base = {
      endpointFile,
      endpointFound: endpoint !== null,
      attached: this.#attached,
      heartbeatRunning: this.#heartbeatTimer !== null,
      versionBlocked: this.#versionBlocked,
      reconnects: this.#reconnects,
      lastFailure: this.#lastFailure,
    };
    const hello = this.#helloResult;
    if (hello === null) {
      return base;
    }
    return {
      ...base,
      daemonVersion: hello.daemonVersion,
      petId: hello.petId,
      pingIntervalMs: this.#pingIntervalMs,
    };
  }

  /**
   * 发一条事件通知：先保证「已 hello」，失败就静默丢掉。
   *
   * @param method 通知方法。
   * @param params 该方法参数。
   */
  async #notify<TMethod extends NotificationMethod>(
    method: TMethod,
    params: MethodParams[TMethod],
  ): Promise<void> {
    const client = await this.#readyClient();
    if (client === null) {
      return;
    }
    try {
      await client.notify(method, params);
    } catch (error) {
      await this.#handleRequestFailure(method, error);
    }
  }

  /**
   * 交出「已经 hello 过」的客户端；没有就现接一次。
   *
   * 每次事件都走这里，所以「pi 先起、daemon 后起」和「daemon 中途重启」
   * 都不需要额外的重连逻辑。
   *
   * @returns 可用的客户端，或 `null`（离线，静默）。
   */
  async #readyClient(): Promise<HttpLitePetClient | null> {
    if (!this.#attached) {
      const client = await this.#resolveClient();
      if (client === null) {
        return null;
      }
      await this.#register(client);
    }
    if (!this.#attached) {
      return null;
    }
    return this.#client;
  }

  /**
   * 拿客户端：有就复用，没有就按退避重新读端点。
   *
   * @returns 客户端，或 `null`（没读到 / 还在退避 / 已放弃）。
   */
  async #resolveClient(): Promise<HttpLitePetClient | null> {
    const existing = this.#client;
    if (existing !== null) {
      return existing;
    }
    if (this.#endpointAttempts >= MAX_ENDPOINT_ATTEMPTS) {
      return null;
    }
    if (Date.now() < this.#nextEndpointAttemptAt) {
      return null;
    }

    const endpoint = await readEndpoint();
    if (endpoint === null) {
      this.#endpointAttempts += 1;
      this.#nextEndpointAttemptAt = Date.now() + retryDelayMs(this.#endpointAttempts);
      this.#lastFailure = "读不到 daemon.json（LitePet 没在运行？）";
      return null;
    }

    this.#endpointAttempts = 0;
    this.#client = new HttpLitePetClient(endpoint);
    return this.#client;
  }

  /**
   * `host/hello` + `daemon/info` + 起心跳。
   *
   * @param client 已建好的客户端。
   */
  async #register(client: HttpLitePetClient): Promise<void> {
    const context = this.#context;
    try {
      const hello = await client.request(Method.HostHello, {
        host: this.host,
        pid: context?.pid ?? process.pid,
        agentVersion: context?.agentVersion,
        clientVersion: context?.clientVersion,
        protocolVersion: PROTOCOL_VERSION,
      });
      if (hello.protocolVersion > PROTOCOL_VERSION) {
        this.#blockOnVersion(hello.protocolVersion);
        return;
      }

      this.#helloResult = hello;
      this.#attached = true;
      this.#lastFailure = null;

      const info = await client.request(Method.DaemonInfo, {});
      this.#applyInfo(info);
      this.#startHeartbeat();
    } catch (error) {
      await this.#handleRequestFailure("host/hello", error);
    }
  }

  /**
   * 处理一次调用失败：区分「RPC 被拒」与「连不上」，并维护重连状态。
   *
   * @param where 出错的 RPC 方法名，仅用于日志。
   * @param error `catch` 到的任意值。
   */
  async #handleRequestFailure(where: string, error: unknown): Promise<void> {
    if (isRpcFailure(error)) {
      if (error.code === ErrorCode.VersionUnsupported) {
        this.#blockOnVersion(readSupportedVersion(error.data));
        return;
      }
      if (error.code === ErrorCode.HostUnknown) {
        // daemon 重启过，登记丢了：就地重新 hello。
        // 只有「hello 本身被拒」时不再重试——否则会自锁成死循环。
        this.#attached = false;
        this.#stopHeartbeat();
        this.#lastFailure = `${where} 被拒：daemon 不认识本宿主，正在重新登记`;
        const client = this.#client;
        if (client !== null && where !== Method.HostHello) {
          this.#reconnects += 1;
          await this.#register(client);
        }
        return;
      }
      this.#lastFailure = `${where} 失败：${error.message}`;
      return;
    }

    // 传输层失败（连不上 / 超时 / HTTP 状态不对）：按「daemon 已退出」处理。
    this.#lastFailure = error instanceof Error ? error.message : String(error);
    this.#stopHeartbeat();
    this.#attached = false;
    this.#client = null;
  }

  /**
   * 记录 `daemon/info` 报的心跳参数。
   *
   * @param info `daemon/info` 的结果。
   */
  #applyInfo(info: DaemonInfoResult): void {
    this.#pingIntervalMs =
      Number.isFinite(info.pingIntervalMs) && info.pingIntervalMs > 0
        ? info.pingIntervalMs
        : FALLBACK_PING_INTERVAL_MS;
  }

  /** 起（或重启）心跳定时器；`unref` 掉，别拖着 pi 不退出。 */
  #startHeartbeat(): void {
    this.#stopHeartbeat();
    const timer = setInterval(() => {
      void this.onHeartbeat({ ts: Date.now() });
    }, this.#pingIntervalMs);
    timer.unref();
    this.#heartbeatTimer = timer;
  }

  /** 停掉心跳定时器。 */
  #stopHeartbeat(): void {
    if (this.#heartbeatTimer !== null) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
  }

  /**
   * 协议版本不兼容：记下原因并彻底停机。
   *
   * 停机而不是降级——发出去的事件 daemon 读不懂，比不发更糟。
   *
   * @param daemonVersion daemon 报告的版本号。
   */
  #blockOnVersion(daemonVersion: number): void {
    this.#versionBlocked = true;
    this.#lastFailure = `协议版本不兼容：daemon 支持 ${daemonVersion}，本插件只到 ${PROTOCOL_VERSION}（已停止发送）`;
    this.#stopHeartbeat();
    this.#attached = false;
    this.#client = null;
  }
}

/**
 * 指数退避：1s、2s、4s……封顶 60s。
 *
 * @param attempt 第几次尝试（从 1 开始）。
 * @returns 距下次尝试的毫秒数。
 */
function retryDelayMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(RETRY_BASE_MS * 2 ** exponent, RETRY_MAX_MS);
}

/**
 * 从 `-32002` 的 `data` 里取「daemon 支持到哪个版本」。
 *
 * @param data 错误体里的 `data`。
 * @returns 版本号；读不到时回落到当前协议版本（只为拼日志）。
 */
function readSupportedVersion(data: unknown): number {
  if (typeof data === "object" && data !== null) {
    const supported = (data as Record<string, unknown>).supported;
    if (typeof supported === "number") {
      return supported;
    }
  }
  return PROTOCOL_VERSION;
}
