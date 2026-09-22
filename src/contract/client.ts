/**
 * daemon 侧的调用面：宿主实现它，宠物包与规则表不感知传输。
 *
 * 这里只给出**签名**。HTTP 客户端怎么建、token 怎么带、失败怎么重试、
 * 要不要在连不上时拉起 daemon——全部是宿主的实现细节。
 */

import type { JsonRpcId, JsonRpcErrorObject } from "./protocol.js";
import type {
  MethodName,
  MethodParams,
  MethodResults,
  NotificationMethod,
  RequestMethod,
} from "./methods.js";

/**
 * daemon 返回的失败应答。
 *
 * 各宿主自行决定用什么类实现它——本包不提供错误类，
 * 只要求「能被 `instanceof` 之外的稳定判别式识别」，见 `code`。
 */
export interface LitePetRpcError {
  /** 见 `ErrorCode`。 */
  readonly code: number;
  /** daemon 给的中文说明，可直接进日志。 */
  readonly message: string;
  /** 仅 `VersionUnsupported` 带 `{ supported }`。 */
  readonly data?: unknown;
}

/**
 * 宿主必须实现的调用面。
 *
 * 泛型把「方法名 → 参数/结果」绑死，写错参数是编译期错误而不是运行期 `-32602`。
 */
export interface LitePetClient {
  /**
   * 发一个**请求**并等待应答。
   *
   * 只接受 `host/hello`、`daemon/ping`、`daemon/info` 三个方法。
   * 失败时抛出实现方的错误，其形状必须兼容 `LitePetRpcError`。
   */
  request<TMethod extends RequestMethod>(
    method: TMethod,
    params: MethodParams[TMethod],
    options?: RequestOptions,
  ): Promise<MethodResults[TMethod]>;

  /**
   * 发一个**通知**：HTTP 上会得到 `204`，没有响应体，也永远不会失败重试。
   *
   * 返回值只表示「已交给 daemon」，不表示 daemon 已处理。
   */
  notify<TMethod extends NotificationMethod>(
    method: TMethod,
    params: MethodParams[TMethod],
    options?: RequestOptions,
  ): Promise<void>;

  /** 该方法是否被本版本声明为通知——供宿主做断言与日志用。 */
  isNotification(method: MethodName): boolean;
}

/** 单次调用的可选参数。 */
export interface RequestOptions {
  /** 覆盖 `id`；缺省由实现方自增。仅对请求有效。 */
  readonly id?: JsonRpcId;
  /** 单次调用超时（毫秒）。 */
  readonly timeoutMs?: number;
  /** 透传给底层 `fetch` 的中止信号，用于宿主退出时取消在途请求。 */
  readonly signal?: AbortSignal;
}

/** 宿主可选实现的探活面：读 `daemon.json`、探活、必要时拉起 daemon。 */
export interface EndpointProvider {
  /** 解析端点；读不到或不可用时返回 `null`，**不要在这里抛错**。 */
  resolve(): Promise<import("./endpoint.js").DaemonEndpoint | null>;
}

/** 把 `JsonRpcErrorObject` 判成 `LitePetRpcError` 的类型守卫签名。 */
export type RpcErrorGuard = (
  candidate: unknown,
) => candidate is JsonRpcErrorObject<unknown>;
