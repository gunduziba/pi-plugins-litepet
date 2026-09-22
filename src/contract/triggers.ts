/**
 * 触发清单：**纯数据契约**，不含接线逻辑。
 *
 * 适配器作者按此表逐条对照宿主的事件库：
 * 找到对应钩子就接上，找不到就显式记录为「本宿主不支持」，
 * 而不是猜一个近似时机——猜错等于播错动画。
 */

import type { HostAdapter, TriggerName, TriggerSpec } from "./host.js";

/** 触发器的完整规格表，键与 `HostAdapter` 的方法名一致。 */
export const TRIGGER_SPECS: Readonly<Record<TriggerName, TriggerSpec>> = Object.freeze({
  onAttach: {
    method: "host/hello",
    kind: "request",
    when: "宿主进程启动、或发现 daemon 不可达后重启 daemon 时",
    fallback: "拿不到版本号就不传 agentVersion / clientVersion，它们只进日志",
  },
  onSessionStart: {
    method: "agent/start",
    kind: "notification",
    when: "用户提交 prompt、一轮 agent 开始工作时",
    fallback: "没有会话 id 就不传 sessionId；只进日志，不影响宠物行为",
  },
  onSessionEnd: {
    method: "agent/end",
    kind: "notification",
    when: "一轮 agent 结束（成功或失败都要发，失败时 success: false）",
    fallback: "无法区分成功失败时发 success: true，不要漏发——漏发会让宠物一直停在工作中",
  },
  onSessionSettled: {
    method: "agent/settled",
    kind: "notification",
    when: "agent 彻底结束、不会再自动继续时（提醒的唯一触发点，见 README 的「三种结束」）",
    fallback:
      "没有「确定结束」的信号就不发：这是提醒点，宁可不提醒也不能每轮都提醒（不要拿 onSessionEnd 顶替）",
  },
  onToolStart: {
    method: "tool/start",
    kind: "notification",
    when: "工具调用即将开始，且该调用预计耗时较长时",
    fallback: "拿不到工具名就不发这条，宁可不发也不要发假名字",
  },
  onToolEnd: {
    method: "tool/end",
    kind: "notification",
    when: "工具调用返回后",
    fallback: "toolName 必须与对应 tool/start 完全相同，否则去重键失效、气泡不会撤",
  },
  onBubble: {
    method: "pet/bubble",
    kind: "notification",
    when: "宿主想直接提示用户时（权限请求、错误、里程碑）",
    fallback: "kind 不认识没关系，daemon 会降级为最低优先级；text 会被截到 48 字",
  },
  onHeartbeat: {
    method: "daemon/ping",
    kind: "request",
    when: "按 daemon/info 报告的 pingIntervalMs 周期发送（当前 20000ms）",
    fallback: "ping 失败按「daemon 已退出」处理：重新读端点或拉起 daemon，不要无限重试",
  },
  onExit: {
    method: "host/bye",
    kind: "notification",
    when: "宿主进程正常退出前",
    fallback: "发不出去也无妨：daemon 会在 hostTimeoutMs（当前 60000ms）后按超时回收",
  },
});

/** 编译期断言：规则表覆盖的 6 个事件都在触发清单里。 */
export type TriggersCoverRuleEvents = keyof typeof TRIGGER_SPECS extends keyof HostAdapter
  ? true
  : never;
