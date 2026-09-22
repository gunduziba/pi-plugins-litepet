/**
 * 事件投递队列：把「发给 daemon」从 pi 的事件回调里摘出去。
 *
 * pi 会逐个 `await` 扩展回调（`dist/core/extensions/runner.js:70`），所以回调里
 * `await` 一次 HTTP 往返 = 让 pi 等一次网络。本队列把发送变成「入队即返回」：
 * 回调立刻交还控制权，真正的发送按**入队顺序**在后台跑。
 *
 * 为什么不是直接 `void adapter.onXxx()`：
 *
 * - **顺序**：`tool/end` 不能跑到对应的 `tool/start` 前面——daemon 按到达顺序维护
 *   活跃工具表。裸 `void` 会让两个 `fetch` 竞争完成顺序。
 * - **兜底**：裸 `void` 一旦有东西抛出去就是 unhandled rejection。这里统一接住。
 * - **积压**：daemon 挂住时每条要等满超时（`client.ts` 的 3 秒），无上限的队列会
 *   让几分钟前的旧事件事后才到，比丢掉更难看。超过 {@link MAX_PENDING} 丢新事件。
 *
 * 队列只保序，不重试：重连与退避都在 `adapter.ts` 里。
 */

/** 队列最多压多少条；再来的事件直接丢弃（只计数，不排队）。 */
export const MAX_PENDING = 32;

/** 投递统计快照。 */
export interface DispatcherStats {
  /** 当前排队（含正在发的那条）的条数。 */
  readonly pending: number;
  /** 因队列过深被丢弃的条数。 */
  readonly dropped: number;
}

/**
 * FIFO 投递队列；不阻塞调用方，内部错误不外冒。
 *
 * 单个实例即全局串行——所有事件共享同一条链，这才是「保序」的意思。
 */
export class EventDispatcher {
  /** 队尾。**永不 rejected**：下面每次接链前都已把错误吃掉。 */
  #tail: Promise<void> = Promise.resolve();
  #pending = 0;
  #dropped = 0;
  readonly #onError: (where: string, error: unknown) => void;

  /**
   * @param onError 任务抛出意料之外的错误时的回调；调用方保证自己不抛。
   */
  constructor(onError: (where: string, error: unknown) => void) {
    this.#onError = onError;
  }

  /** 当前排队数与累计丢弃数。 */
  get stats(): DispatcherStats {
    return { pending: this.#pending, dropped: this.#dropped };
  }

  /**
   * 入队一条事件，立刻返回。
   *
   * @param where 出错时用于记账的标签（一般是 RPC 方法名）。
   * @param task 真正要做的事；由队列串行调用。
   * @returns 入队成功为 `true`；因队列已满被丢弃为 `false`。
   */
  push(where: string, task: () => Promise<void>): boolean {
    if (this.#pending >= MAX_PENDING) {
      this.#dropped += 1;
      return false;
    }
    this.#pending += 1;
    this.#tail = this.#tail.then(() => this.#run(where, task));
    return true;
  }

  /**
   * 等队列跑空。
   *
   * 专给 `session_shutdown` 用：pi 退出前得让 `host/bye` 真的发出去，
   * 但那一下也不能无限等。
   *
   * @param timeoutMs 最多等多久。
   * @returns 按时跑空为 `true`；超时为 `false`（剩下的交给 daemon 的心跳超时回收）。
   */
  async drain(timeoutMs: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const expired = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
      // 不让这个计时器把 pi 的退出拖住。
      timer.unref();
    });
    try {
      return await Promise.race([this.#tail.then(() => true), expired]);
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * 跑一条任务，把 `#pending` 收回来，并且**绝不让错误逃出链子**。
   *
   * @param where 出错时的标签。
   * @param task 任务本体。
   */
  async #run(where: string, task: () => Promise<void>): Promise<void> {
    try {
      await task();
    } catch (error) {
      try {
        this.#onError(where, error);
      } catch {
        // 记账本身失败也得咽下去，否则链子会变成 rejected。
      }
    } finally {
      this.#pending -= 1;
    }
  }
}
