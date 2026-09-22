/**
 * 手工冒烟：用 pi 自己的加载器（jiti）加载适配器，对活着的 daemon 走一遍全部触发器。
 *
 * 用法：
 *   node scripts/smoke.mjs            # 跑一遍全部事件
 *   node scripts/smoke.mjs status     # 只看连接状态，不发事件
 *
 * 用 jiti 而不是 node --experimental-strip-types，是因为源码里的 import 写的是
 * `./client.js`（TS 的 NodeNext 风格），只有 jiti 会把它解析到 `.ts`。
 * jiti 是本包的 devDependency；pi 自己也带一份同规格的，版本对齐即可。
 */

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { PiHostAdapter } = await jiti.import("../src/adapter.ts");

const adapter = new PiHostAdapter();
await adapter.onAttach({ host: "pi", agentVersion: "smoke-harness", pid: process.pid });

if (process.argv[2] !== "status") {
  await adapter.onSessionStart({ sessionId: "smoke" });
  await adapter.onToolStart({ toolName: "read" });
  await adapter.onToolEnd({ toolName: "read" });
  await adapter.onToolStart({ toolName: "edit" });
  await adapter.onToolEnd({ toolName: "edit", isError: true });
  await adapter.onSessionEnd({ sessionId: "smoke", success: true, note: "2 个工具 · 3 秒" });
  await adapter.onSessionSettled({ sessionId: "smoke", note: "2 个工具 · 3 秒" });
  await adapter.onBubble({ kind: "info", text: "冒烟测试气泡" });
}

console.log(JSON.stringify(await adapter.getStatus(), null, 2));
await adapter.onExit({ reason: "smoke done" });
