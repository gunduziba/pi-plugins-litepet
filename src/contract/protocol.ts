/**
 * LitePet 线格式的公共常量与 JSON-RPC 2.0 信封类型。
 *
 * 本文件（以及本包全部文件）**只声明契约**：类型与常量。
 * 传输、重连、心跳、事件映射等实现一律由宿主（pi / dsh）自理，
 * 见 `README.md` 的「宿主需要实现什么」。
 *
 * 权威来源：`litepet` 仓库的 `docs/PROTOCOL.md`。
 */

/** 本包声明的协议版本。`host/hello` 里报高于此值的版本会被 daemon 回 `-32002`。 */
export const PROTOCOL_VERSION = 1;

/** JSON-RPC 2.0 的 `jsonrpc` 字面量。 */
export const JSONRPC_VERSION = "2.0";

/** daemon 只监听回环地址，宿主不得假设其他地址。 */
export const LOOPBACK_HOST = "127.0.0.1";

/** RPC 路径：`POST http://127.0.0.1:<port>/rpc`。 */
export const RPC_PATH = "/rpc";

/** 气泡正文上限（按字符计），超出由 daemon 截断并以 `…` 结尾。 */
export const BUBBLE_TEXT_LIMIT = 48;

/** 气泡详情上限（保留给后续版本，v1 线格式无独立 detail 字段）。 */
export const BUBBLE_DETAIL_LIMIT = 120;

/**
 * `id` 允许字符串或数字。
 *
 * `null` 只出现在**无法识别原请求**的响应里——即解析失败（`-32700`）
 * 与请求对象非法（`-32600`），因为连 `id` 都没解出来。
 */
export type JsonRpcId = string | number;

/** 带 `id` 的调用：期望一个应答。 */
export interface JsonRpcRequest {
  readonly jsonrpc: typeof JSONRPC_VERSION;
  readonly method: string;
  readonly params: unknown;
  readonly id: JsonRpcId;
}

/** 不带 `id` 的调用：**没有应答通道，也从不需要 ack**。 */
export interface JsonRpcNotification {
  readonly jsonrpc: typeof JSONRPC_VERSION;
  readonly method: string;
  readonly params: unknown;
}

/** 成功应答。注意 daemon 对通知回 HTTP `204`，没有响应体。 */
export interface JsonRpcSuccess<TResult> {
  readonly jsonrpc: typeof JSONRPC_VERSION;
  readonly result: TResult;
  readonly id: JsonRpcId;
}

/** 失败应答。 */
export interface JsonRpcErrorObject<TData = unknown> {
  readonly code: number;
  readonly message: string;
  readonly data?: TData;
}

/** 失败应答信封。 */
export interface JsonRpcFailure<TData = unknown> {
  readonly jsonrpc: typeof JSONRPC_VERSION;
  readonly error: JsonRpcErrorObject<TData>;
  readonly id: JsonRpcId | null;
}

/** 应答联合。 */
export type JsonRpcResponse<TResult, TData = unknown> =
  | JsonRpcSuccess<TResult>
  | JsonRpcFailure<TData>;

/**
 * daemon 会返回的错误码。
 *
 * 前五个是 JSON-RPC 2.0 标准码，后两个是 LitePet 自定义码。
 */
export const ErrorCode = {
  /** 请求体不是合法 JSON（此时 `id` 必为 `null`）。 */
  ParseError: -32700,
  /** 不是合法 JSON-RPC 2.0 对象。**批量数组请求也回此码**（本协议不支持批量）。 */
  InvalidRequest: -32600,
  /** 请求里的 `method` 不认识。 */
  MethodNotFound: -32601,
  /** `params` 缺字段或类型不对。 */
  InvalidParams: -32602,
  /** daemon 内部异常。 */
  InternalError: -32603,
  /** 宿主未 `host/hello` 就发事件，或已被注销。 */
  HostUnknown: -32001,
  /** `host/hello` 的协议版本高于 daemon 支持的版本。 */
  VersionUnsupported: -32002,
} as const;

/** 错误码取值类型。 */
export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** `-32002` 的 `error.data`：告知 daemon 支持的最高版本。 */
export interface VersionUnsupportedData {
  readonly supported: number;
}

/**
 * 气泡语义类别；**声明顺序即优先级**，越靠后越优先抢屏。
 *
 * 公式即优先级，越大越优先（`docs/PROTOCOL.md` §6）。
 */
export const BubblePriority = {
  /** 本版不认识的类别——不抢屏，落到无着色基础样式。 */
  unknown: 0,
  info: 1,
  status: 2,
  tool: 3,
  success: 4,
  warning: 5,
  error: 6,
} as const;

/** 本版认识的气泡类别。 */
export type BubbleKind = keyof typeof BubblePriority;

/**
 * 线上可发的气泡类别：任何字符串都合法。
 *
 * daemon 对认不出的类别**退化处理而不是报错**——适配器独立于 daemon 发版，
 * 可能先引入新类别；若直接拒绝，一条 `kind: "celebrate"` 的 `pet/bubble`
 * 整条会被回 `-32602`，而通知没有回复通道，适配器作者只会看到「什么都没发生」。
 */
export type BubbleKindWire = BubbleKind | (string & {});
