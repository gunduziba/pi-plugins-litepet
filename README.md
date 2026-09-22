# pi-plugins-litepet

把 **pi**（TUI coding agent）的会话状态与工具调用接到 **LitePet** 桌面宠物：
会话一开宠物出来、跑工具时它在忙、这一轮彻底干完它做个提醒动作、pi 退出它回托盘。

宠物做什么动作不由本插件决定——插件只负责把事件翻译成 LitePet 宿主协议
（`host/hello`、`agent/start`、`tool/start` …），「哪条事件配哪个动画、哪句话」
由宠物包自己的规则表（`pet.json` 的 `litepet.behavior`）决定。

## 前置条件

1. LitePet（daemon）在跑。它会在 `~/.litepet/daemon.json` 写下端点文件。
2. 端口与 token **不在插件里配**：每次 `session_start` 都从端点文件现读
   （`token` 为空串表示 daemon 关掉了鉴权，此时请求不带 `Authorization` 头）。
3. 不需要 daemon 一直活着：pi 先启动、LitePet 后启动也能接上，见下文「退避与自愈」。

## 安装

```bash
# 下文的 <本仓库路径> 换成你 clone 到的地方，比如 ~/tools/pi-plugins-litepet

# 1) 作为本地包安装（写 ~/.pi/agent/settings.json，加 -l 写项目级 .pi/settings.json）
pi install <本仓库路径>

# 2) 或者临时挂一次，不落任何配置
pi -e <本仓库路径>/src/index.ts

# 3) 或者手工在 settings.json 里加路径
#    { "extensions": ["<本仓库路径>/src/index.ts"] }
```

加载后 `pi list` 能看到它，卸载用 `pi remove pi-plugins-litepet`。

依赖 `litepet-adapter-ts`（`file:../litepet-adapter-ts`）：那是一个**纯契约包**，
只有类型与常量，传输层（HTTP 客户端、超时、错误翻译）在本仓库的 `src/client.ts` 里。

## 命令

| 命令 | 作用 |
|---|---|
| `/litepet` | 看连接状态：连没连上、宠物包 id、daemon 版本、心跳间隔、重连次数、最近一次失败原因 |
| `/litepet test` | 让宠物弹一条测试气泡，用来验证链路通不通 |

## 事件映射

| pi 事件 | 发给 daemon 的 RPC | 说明 |
|---|---|---|
| `session_start` | `host/hello` + `daemon/info`（起心跳） | 只在 `startup`/`new`/`resume`/`fork` 都发 |
| `agent_start` | `agent/start` | 宠物切成「忙」 |
| `tool_execution_start` | `tool/start` | **不带 `bubble`**：文案交给宠物包的规则表插值 |
| `tool_execution_end` | `tool/end`（带 `isError`） | |
| `agent_end` | `agent/end`（带 `success` 与 `note`） | |
| `agent_settled` | `agent/settled`（带 `note`） | **提醒只由这条触发** |
| `session_compact` / `session_compact_failed` | `pet/bubble` | 「上下文已压缩 / 压缩失败」 |
| `session_shutdown` | `host/bye` | 宠物回托盘 |

三个 pi 侧的坑，接线时踩过：

- **`agent_end` 里没有 `success` 字段**。成功与失败只能从 `event.messages` 里最后一条
  assistant 的 `stopReason` 推，规则是「**只有 `error` 算失败**」：`stop`/`length`/`toolUse`
  算成功，`aborted` 也算成功（是用户自己按的 Esc，不是干活失败，归成失败会让每次打断都弹提醒）；
  找不到 assistant 消息时也算成功（不伪造失败）。见 `src/outcome.ts`。
- **`agent_end` ≠ 这一轮真的结束了**。pi 之后可能自动重试、自动压缩后继续、或者接着跑
  排队的 follow-up。所以「提醒用户」只能挂在 `agent_settled` 上，否则会在每次自动重试时
  响一遍。
- **扩展工厂里不许起后台资源**（socket、定时器、子进程都算）。心跳是在 `session_start`
  里 `hello` 成功之后才起的，并且 `unref()` 了，不拖住 pi 退出。

**投递是异步的**：上面每个回调都只把任务丢进队列就交还控制权，**绝不 `await` HTTP**。
pi 会逐个 `await` 扩展回调（`dist/core/extensions/runner.js:70`），同步发就意味着每个工具调用
都要让 pi 等一次网络往返。实测（假 daemon 每条延迟 400ms）：异步下 6 个回调合计 **0ms**，
同步时大约 2.8s；而 daemon 收到的顺序仍是 `host/hello → daemon/info → agent/start →
tool/start → tool/end → agent/end → agent/settled`，一条不乱。

细节见 `src/dispatch.ts`：

- 单一 FIFO 链，所以 `tool/end` 不会跑到对应的 `tool/start` 前面。
- 队列上限 32 条，超出丢新事件并计数（`/litepet` 能看到）；daemon 挂住时不让旧事件事后才到。
- 队列里冒出的意外错误被接住，绝不变 unhandled rejection。
- 只有 `session_shutdown` 会等一下队列排空（上限 1.5s），好让 `host/bye` 真的发出去。

### 通知正文（`note`）

提醒里的正文由 `src/note.ts` 生成，形状是「[失败 ·] 工具情况 · 用时」：
`3 个工具 · 1 分 20 秒`、`失败 · 2 个工具 · bash 出错 · 41 秒`、`没调工具 · 8 秒`。

它**只是备选**：宠物包里写了 `alert.text` 时 daemon 用包里的，这里的 `note` 不生效；
插件不写 `note` 也不会让通知变空，daemon 会回落到事件自带的默认句（如「本轮会话结束」）。

不推助手正文是刻意的：通知里塞一段可能带代码的正文只会变成噪声，而用时与工具数是
**确定可测**的事实，不需要模型参与。想改成别的（比如助手最后一句）只需动 `src/note.ts`。

## 容错行为（三条硬规矩）

1. **任何失败都不许冒泡到宿主**。宠物纯粹是装饰，它挂了不能影响 pi 的会话——
   所有 RPC 都被吞进状态里，`/litepet` 能看到原因，但事件回调不抛错。
2. **daemon 不在时不无限重试**：读端点失败按指数退避（1s 起，上限 60s，最多 5 次），
   之后彻底放弃，直到下一次 `session_start` 才重新给机会。
3. **协议版本不支持就闭嘴**：`host/hello` 报的版本比本插件高就停机，宁可什么都不发，
   也不让 daemon 收到读不懂的事件（`/litepet` 会显示「协议版本不兼容」）。

退避与自愈：

- **daemon 中途重启**：心跳请求会收到 `-32001 HostUnknown`，插件就地重新 `host/hello`，
  不需要重启 pi。重连次数在 `/litepet` 里能数出来。
- **连不上**（`ECONNREFUSED`）：丢弃客户端，下一次事件重新读端点建连。
- **单次调用超时 3 秒**（`src/client.ts` 的 `DEFAULT_TIMEOUT_MS`）。daemon 在回环上，
  正常是毫秒级；工具调用是热路径，超时拖长只会让队列里的旧事件事后才到。
- `agent/start`、`tool/*`、`pet/bubble`、`host/bye` 都是**通知**（JSON-RPC notification），
  daemon 不回包；只有 `host/hello`、`daemon/ping`、`daemon/info` 是请求。
  心跳间隔取 `daemon/info` 报的值（当前实现 20s），拿不到时兜底 20s——daemon 那边
  60s 收不到 ping 就认为宿主死了。

## 排错

先 `/litepet`。常见几条：

| 现象 | 原因 |
|---|---|
| 未连接 + 「读不到 daemon.json」 | LitePet 没在跑 |
| 未连接 + 「connect ECONNREFUSED …」 | 端点文件在，但那端口上没人（daemon 异常退出残留） |
| 「HTTP 401，token 不匹配」 | `~/.litepet/config.json` 的 `auth.token` 与端点文件里的对不上（一般不会，除非手工改过） |
| 「HTTP 503」 | token 里含空白或非 ASCII，daemon 把鉴权锁死了 |
| 「协议版本不兼容」 | daemon 升级了协议；升级本插件 |
| 什么都没发生但「已连接」 | 宠物包没有规则表 → 动作由 daemon 的降级映射决定，可能不响 |

daemon 侧的对照日志在 `~/.litepet/logs/daemon.log`，里面能看到 `宿主 pi 已接入`、
`宿主 pi 开始工作`、`规则命中提醒：agent.settled` 这些行。

## 代码结构

| 文件 | 管什么 |
|---|---|
| `src/index.ts` | 只做接线：pi 事件 → adapter 方法；注册 `/litepet` 命令 |
| `src/adapter.ts` | 决策：什么时候发、发什么、失败怎么记账、心跳与重连 |
| `src/client.ts` | 传输：HTTP + JSON-RPC、超时、错误分类（RPC 失败 vs 连不上） |
| `src/endpoint.ts` | 读 `~/.litepet/daemon.json`，定位家目录 |
| `src/outcome.ts` | 从 pi 的消息里推 `agent/end` 的 `success` |
| `src/note.ts` | 给提醒凑正文：一轮的工具数与用时 → 一句中文 |
| `src/dispatch.ts` | 投递队列：回调不再等 HTTP，保序 + 有界 + 吞错 |
| `scripts/smoke.mjs` | 手工冒烟：喂一轮假事件，看真实 daemon 的反应 |

换宿主（比如 dsh）时只需要重写 `src/index.ts`，其余六个文件与宿主无关。

## 检查

```bash
npm run typecheck      # tsc --noEmit，零输出为通过
node scripts/smoke.mjs # 需要 LitePet 正在运行
```
