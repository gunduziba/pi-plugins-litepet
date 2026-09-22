/**
 * 给提醒凑一句正文（`agent/end` 与 `agent/settled` 的 `note` 参数）。
 *
 * 为什么用「统计」而不是「助手最后说了什么」：note 会进系统通知与手机推送，
 * 助手正文可能很长、可能整段是代码，塞进通知只会变成噪声，还得自己再截一次。
 * 用时与工具数是这一轮**确定可测**的事实，不需要任何模型参与，也不会泄露正文。
 *
 * daemon 侧对正文另有 120 字符上限（`docs/PROTOCOL.md`），这里先自己截到 60，
 * 免得通知里出现被砍一半的词。
 */

/** 一轮里累计出来的事实。 */
export interface TurnFacts {
  /** 这一轮开始至今的毫秒数。 */
  readonly elapsedMs: number;
  /** 这一轮发生的工具调用次数。 */
  readonly toolCount: number;
  /** 这一轮出错过的工具名，按发生顺序、已去重。 */
  readonly failedTools: readonly string[];
}

/** 正文自截断长度。 */
const MAX_NOTE_CHARS = 60;
/** 最多点几个出错工具：再多就把「几个工具、多久」挤掉了。 */
const MAX_FAILED_TOOLS = 2;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

/**
 * 把一轮事实拼成通知正文。
 *
 * 形状固定为「[失败 ·] 工具情况 · 用时」，例如：
 * `3 个工具 · 1 分 20 秒`、`失败 · 2 个工具 · bash 出错 · 41 秒`、`没调工具 · 8 秒`。
 *
 * @param facts 这一轮的统计。
 * @param success 这一轮是不是成功。
 * @returns 不超过 {@link MAX_NOTE_CHARS} 个字符的正文。
 */
export function formatNote(facts: TurnFacts, success: boolean): string {
  const parts: string[] = [];
  if (!success) {
    parts.push("失败");
  }
  if (facts.toolCount === 0) {
    parts.push("没调工具");
  } else {
    parts.push(`${facts.toolCount} 个工具`);
    if (facts.failedTools.length > 0) {
      parts.push(`${facts.failedTools.slice(0, MAX_FAILED_TOOLS).join("、")} 出错`);
    }
  }
  parts.push(formatDuration(facts.elapsedMs));
  return truncate(parts.join(" · "));
}

/**
 * 记账器：`agent_start` 时清零，`agent_end` / `agent_settled` 时取走一份快照。
 *
 * 状态跟着扩展工厂的闭包走。pi 一个进程里同时只有一个会话，所以不用区分会话；
 * 但**必须**记住「这一轮到底有没有开始过」——没开始过就给 `null`，
 * 让 daemon 用它自己的兜底正文，而不是报一句来路不明的统计。
 */
export class TurnTracker {
  #startedAtMs = 0;
  #toolCount = 0;
  #failedTools: string[] = [];
  #running = false;

  /**
   * 一轮开始（`agent_start`）。
   *
   * @param nowMs 当前毫秒时间戳。
   */
  start(nowMs: number): void {
    this.#startedAtMs = nowMs;
    this.#toolCount = 0;
    this.#failedTools = [];
    this.#running = true;
  }

  /** 记一次工具调用开始（`tool_execution_start`）。 */
  countTool(): void {
    this.#toolCount += 1;
  }

  /**
   * 记一次工具出错（`tool_execution_end` 且 `isError`）。同名工具只记一次。
   *
   * @param toolName 工具名，由 pi 给出。
   */
  markToolFailed(toolName: string): void {
    if (!this.#failedTools.includes(toolName)) {
      this.#failedTools.push(toolName);
    }
  }

  /**
   * 取一份快照。
   *
   * @param nowMs 当前毫秒时间戳。
   * @returns 这一轮的事实；这一轮没开始过时给 `null`。
   */
  snapshot(nowMs: number): TurnFacts | null {
    if (!this.#running) {
      return null;
    }
    return {
      elapsedMs: nowMs - this.#startedAtMs,
      toolCount: this.#toolCount,
      failedTools: [...this.#failedTools],
    };
  }
}

/**
 * 毫秒 → 人话时长。
 *
 * @param elapsedMs 毫秒数，负数按 0 算。
 * @returns 形如 `8 秒` / `1 分 20 秒` / `2 小时 5 分`。
 */
function formatDuration(elapsedMs: number): string {
  const seconds = Math.max(0, Math.round(elapsedMs / MS_PER_SECOND));
  if (seconds < SECONDS_PER_MINUTE) {
    return `${seconds} 秒`;
  }
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  if (minutes < MINUTES_PER_HOUR) {
    return `${minutes} 分 ${seconds % SECONDS_PER_MINUTE} 秒`;
  }
  return `${Math.floor(minutes / MINUTES_PER_HOUR)} 小时 ${minutes % MINUTES_PER_HOUR} 分`;
}

/**
 * 截到上限，超出用省略号收尾。
 *
 * @param text 原文。
 * @returns 不超过 {@link MAX_NOTE_CHARS} 个字符的文本。
 */
function truncate(text: string): string {
  return text.length <= MAX_NOTE_CHARS ? text : `${text.slice(0, MAX_NOTE_CHARS - 1)}…`;
}
