/**
 * LitePet 宿主协议契约与接口定义。
 *
 * 导出与 LitePet 守护进程通信所需的类型、枚举与协议常量。
 *
 * 权威协议来源：`litepet` 仓库的 `docs/PROTOCOL.md`。
 */

export type {
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcNotification,
  JsonRpcSuccess,
  JsonRpcFailure,
  JsonRpcResponse,
  JsonRpcErrorObject,
  ErrorCodeValue,
  VersionUnsupportedData,
  BubbleKind,
  BubbleKindWire,
} from "./protocol.js";

export {
  PROTOCOL_VERSION,
  JSONRPC_VERSION,
  LOOPBACK_HOST,
  RPC_PATH,
  BUBBLE_TEXT_LIMIT,
  BUBBLE_DETAIL_LIMIT,
  ErrorCode,
  BubblePriority,
} from "./protocol.js";

export type {
  DaemonEndpoint,
  EndpointLocation,
} from "./endpoint.js";

export {
  HOME_ENV,
  HOME_DIR_NAME,
  ENDPOINT_FILE,
  CONFIG_FILE,
  PETS_DIR,
} from "./endpoint.js";

export type {
  MethodName,
  RequestMethod,
  NotificationMethod,
  HostScopedParams,
  HostHelloParams,
  HostHelloResult,
  HostByeParams,
  AgentStartParams,
  AgentEndParams,
  AgentSettledParams,
  ToolStartParams,
  ToolEndParams,
  PetBubbleParams,
  DaemonPingParams,
  DaemonPingResult,
  DaemonInfoParams,
  DaemonInfoResult,
  MethodParams,
  MethodResults,
  RuleEvent,
  RuleEventMethod,
} from "./methods.js";

export { Method } from "./methods.js";

export type {
  LitePetClient,
  LitePetRpcError,
  RequestOptions,
  EndpointProvider,
  RpcErrorGuard,
} from "./client.js";

export type {
  HostId,
  HostContext,
  SessionStartInput,
  SessionEndInput,
  SessionSettledInput,
  ToolStartInput,
  ToolEndInput,
  BubbleInput,
  HeartbeatInput,
  ExitInput,
  HostAdapter,
  RuleEventTrigger,
  RuleEventIsCovered,
  TriggerName,
  TriggerSpec,
} from "./host.js";

export { TRIGGER_SPECS } from "./triggers.js";
export type { TriggersCoverRuleEvents } from "./triggers.js";
