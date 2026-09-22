/**
 * HTTP + JSON-RPC 客户端。
 *
 * `litepet-adapter-ts` 只给签名，传输由宿主实现——本文件就是 pi 侧的那份实现。
 * 三件事固定在这里：回环地址、一个进程内自增的 `id`、以及「token 为空就不带
 * `Authorization` 头」（daemon 的 `AuthGate::Open` 分支）。
 */

import {
  JSONRPC_VERSION,
  LOOPBACK_HOST,
  Method,
  RPC_PATH,
  type DaemonEndpoint,
  type LitePetClient,
  type LitePetRpcError,
  type MethodName,
  type MethodParams,
  type MethodResults,
  type NotificationMethod,
  type RequestMethod,
  type RequestOptions,
} from "litepet-adapter-ts";

/**
 * 单次调用默认超时（毫秒）。
 *
 * 取 3 秒：daemon 就在本机回环上，正常往返是毫秒级；而 pi 的
 * `tool_execution_start` 是热路径，不能在这里挂太久。
 */
export const DEFAULT_TIMEOUT_MS = 3000;

/** 三个**请求**方法；其余都是通知。 */
const REQUEST_METHODS: ReadonlySet<MethodName> = new Set<MethodName>([
  Method.HostHello,
  Method.DaemonPing,
  Method.DaemonInfo,
]);

/** daemon 应答里的 JSON-RPC 失败体。 */
export interface RpcFailureBody {
  /** 见 `ErrorCode`。 */
  readonly code: number;
  /** daemon 给的中文说明。 */
  readonly message: string;
  /** 仅 `VersionUnsupported` 带 `{ supported }`。 */
  readonly data?: unknown;
}

/**
 * JSON-RPC 层失败（daemon 明确回了一个 `error`）。
 *
 * 形状兼容 `LitePetRpcError`，可以直接按 `code` 判别，不必 `instanceof`。
 */
export class LitePetRpcFailure extends Error implements LitePetRpcError {
  /** 见 `ErrorCode`。 */
  readonly code: number;

  /** 仅 `VersionUnsupported` 带 `{ supported }`。 */
  readonly data?: unknown;

  /**
   * @param failure daemon 应答里的 `error` 对象。
   */
  constructor(failure: RpcFailureBody) {
    super(`LitePet RPC ${failure.code}: ${failure.message}`);
    this.name = "LitePetRpcFailure";
    this.code = failure.code;
    this.data = failure.data;
  }
}

/**
 * 传输层失败：连不上、超时、HTTP 状态不对、响应体不是 JSON。
 *
 * 与 `LitePetRpcFailure` 分开，是因为两边的处置不同：
 * RPC 失败说明 daemon 活着（可能是我们姿势不对），传输失败说明它不在。
 */
export class LitePetTransportError extends Error {
  /** HTTP 状态码；没走到响应就没有。 */
  readonly status?: number;

  /**
   * @param message 人类可读的原因。
   * @param status HTTP 状态码（可选）。
   */
  constructor(message: string, status?: number) {
    super(message);
    this.name = "LitePetTransportError";
    this.status = status;
  }
}

/**
 * 判别式：是不是 daemon 回的 RPC 失败。
 *
 * @param candidate 任意值，通常是 `catch` 到的东西。
 * @returns 是则收窄为 `LitePetRpcFailure`。
 */
export function isRpcFailure(candidate: unknown): candidate is LitePetRpcFailure {
  return candidate instanceof LitePetRpcFailure;
}

/**
 * 回环上的 LitePet daemon 客户端。
 *
 * 无状态、可丢弃：daemon 重启后重新 new 一个即可，不需要 `close()`。
 */
export class HttpLitePetClient implements LitePetClient {
  readonly #url: string;
  readonly #token: string;
  readonly #timeoutMs: number;
  #nextId = 1;

  /**
   * @param endpoint 从 `daemon.json` 读到的端点。
   * @param timeoutMs 单次调用超时，缺省 {@link DEFAULT_TIMEOUT_MS}。
   */
  constructor(endpoint: DaemonEndpoint, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.#url = `http://${LOOPBACK_HOST}:${endpoint.port}${RPC_PATH}`;
    this.#token = endpoint.token;
    this.#timeoutMs = timeoutMs;
  }

  /** 回环 URL，仅供日志与自检展示。 */
  get url(): string {
    return this.#url;
  }

  async request<TMethod extends RequestMethod>(
    method: TMethod,
    params: MethodParams[TMethod],
    options: RequestOptions = {},
  ): Promise<MethodResults[TMethod]> {
    const payload = {
      jsonrpc: JSONRPC_VERSION,
      id: options.id ?? this.#nextId++,
      method,
      params,
    };
    const body = await this.#post(payload, options);

    const failure = readFailureBody(body);
    if (failure !== null) {
      throw new LitePetRpcFailure(failure);
    }
    return readResult<MethodResults[TMethod]>(body);
  }

  async notify<TMethod extends NotificationMethod>(
    method: TMethod,
    params: MethodParams[TMethod],
    options: RequestOptions = {},
  ): Promise<void> {
    const payload = { jsonrpc: JSONRPC_VERSION, method, params };
    await this.#post(payload, options);
  }

  isNotification(method: MethodName): boolean {
    return !REQUEST_METHODS.has(method);
  }

  /**
   * 发一次 POST；超时用 `AbortSignal.timeout`，与调用方给的 `signal` 合并。
   *
   * @param payload 完整 JSON-RPC 报文。
   * @param options 超时与取消信号。
   * @returns 解析后的响应体；通知的 `204` 空体返回 `null`。
   */
  async #post(payload: unknown, options: RequestOptions): Promise<unknown> {
    const signals: AbortSignal[] = [
      AbortSignal.timeout(options.timeoutMs ?? this.#timeoutMs),
    ];
    if (options.signal !== undefined) {
      signals.push(options.signal);
    }

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.#token !== "") {
      headers.authorization = `Bearer ${this.#token}`;
    }

    let response: Response;
    try {
      response = await fetch(this.#url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.any(signals),
      });
    } catch (cause) {
      throw new LitePetTransportError(
        `连不上 LitePet daemon（${this.#url}）：${describeCause(cause)}`,
      );
    }

    if (!response.ok) {
      throw new LitePetTransportError(
        `daemon 拒绝请求：${describeStatus(response.status)}`,
        response.status,
      );
    }

    const text = await response.text();
    if (text.trim() === "") {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      return parsed;
    } catch {
      throw new LitePetTransportError("daemon 回了非 JSON 的响应体");
    }
  }
}

/**
 * 从响应体里取出 `error`。
 *
 * @param body `JSON.parse` 的结果。
 * @returns 失败体，或 `null`（不是失败应答）。
 */
function readFailureBody(body: unknown): RpcFailureBody | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const error = (body as Record<string, unknown>).error;
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const record = error as Record<string, unknown>;
  if (typeof record.code !== "number" || typeof record.message !== "string") {
    return null;
  }
  return {
    code: record.code,
    message: record.message,
    data: record.data,
  };
}

/**
 * 从响应体里取 `result`。
 *
 * @param body `JSON.parse` 的结果。
 * @returns 已按方法名绑定好类型的 `result`。
 */
function readResult<TResult>(body: unknown): TResult {
  if (typeof body !== "object" || body === null || !("result" in body)) {
    throw new LitePetTransportError("daemon 回了没有 result 的应答");
  }
  return (body as { result: TResult }).result;
}

/**
 * 把 HTTP 状态码翻译成排错提示。
 *
 * 401 / 503 的区别是 daemon 定的：`503` 表示 token 本身非法（含空白或非
 * ASCII），不是「密钥不对」。
 *
 * @param status HTTP 状态码。
 * @returns 中文提示。
 */
function describeStatus(status: number): string {
  if (status === 401) {
    return "HTTP 401，token 不匹配（检查 ~/.litepet/config.json 的 auth.token）";
  }
  if (status === 503) {
    return "HTTP 503，token 含空白或非 ASCII，鉴权已被锁死";
  }
  return `HTTP ${status}`;
}

/**
 * 把 fetch 抛出来的东西变成一句话。
 *
 * @param cause `catch` 到的任意值。
 * @returns 中文原因（超时会被单独点出来，因为它是唯一「大概率只是慢」的失败）。
 */
function describeCause(cause: unknown): string {
  if (cause instanceof Error) {
    if (cause.name === "TimeoutError") {
      return "超时";
    }
    if (cause.name === "AbortError") {
      return "调用方已取消";
    }
    // undici 外层只给一句 "fetch failed"，真正有用的在内面的 cause 里
    // （ECONNREFUSED / ENOTFOUND 之类）。只拆一层。
    const inner = cause.cause;
    if (inner instanceof Error && inner.message !== "") {
      return inner.message;
    }
    return cause.message;
  }
  return String(cause);
}
