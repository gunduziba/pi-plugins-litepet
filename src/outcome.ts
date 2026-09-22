/**
 * 从 pi 的一轮消息里推导「这一轮成了没有」。
 *
 * 为什么需要推导：pi 的 `agent_end` 事件**只有 `messages`，没有 `success` 字段**
 * （`dist/core/extensions/types.d.ts:555`），而 daemon 的 `agent/end` 明确要
 * 一个布尔 `success`。所以只能从最后一条 assistant 消息的 `stopReason` 判。
 *
 * 推断逐条对齐 pi 的类型定义（`@earendil-works/pi-ai` 的 `AssistantMessage.stopReason`，
 * `StopReason` = `"stop" | "length" | "toolUse" | "error" | "aborted"`）：
 *
 * | stopReason | 上报 | 为什么 |
 * |---|---|---|
 * | `error` | `false` | 唯一的失败语义 |
 * | `aborted` | `true` | 用户自己按的 Esc/中断，不是「干活失败」；归为失败会让每次打断都弹提醒 |
 * | `stop` / `length` / `toolUse` / 其它 | `true` | 正常收尾或还有后续（后续由 `agent/start` 重新开一段） |
 *
 * 参数取 `unknown` 而不是 pi 的 `AgentMessage`：pi 允许扩展注册自定义消息类型，
 * 联合体里未必每种都带 `stopReason`，这里按字段存在性判更稳。
 */

/** `stopReason` 里唯一的失败取值。 */
const STOP_REASON_ERROR = "error";

/**
 * 一轮是不是成功。
 *
 * 找不到 assistant 消息（例如空跑一轮）时按成功算——**不要伪造失败**：
 * 一次假的 `-`（失败脸色 + 失败音效）比漏报难解释得多。
 *
 * @param messages `agent_end` 事件里的消息数组，顺序即时间序。
 * @returns `true` 表示按成功上报。
 */
export function deriveSuccess(messages: readonly unknown[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const assistant = asAssistant(message);
    if (assistant !== null) {
      return assistant.stopReason !== STOP_REASON_ERROR;
    }
  }
  return true;
}

/** assistant 消息里我们要的那个字段。 */
interface AssistantStopReason {
  /** 收尾原因；缺省表示这条消息不是我们认识的 assistant 消息。 */
  readonly stopReason?: string;
}

/**
 * 结构判定：这条消息是不是 assistant，是就取它的 `stopReason`。
 *
 * @param message `messages` 里的任意一项。
 * @returns 命中的话给出 `stopReason`；不是 assistant 则 `null`。
 */
function asAssistant(message: unknown): AssistantStopReason | null {
  if (typeof message !== "object" || message === null) {
    return null;
  }
  const record = message as Record<string, unknown>;
  if (record.role !== "assistant") {
    return null;
  }
  const stopReason = record.stopReason;
  return { stopReason: typeof stopReason === "string" ? stopReason : undefined };
}
