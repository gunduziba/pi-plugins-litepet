# pi-plugins-litepet 🐾

把 [pi](https://github.com/earendil-works/pi-coding-agent)（TUI 终端 Coding Agent）的会话状态、工具执行与任务结果，无缝同步到 **LitePet 桌面宠物**。

当你在终端与 pi 对话编程时，桌面上的小宠物会根据当前的实时状态进行生动的动画联动：开始写代码时认真敲键盘、执行 bash/读写文件时头顶弹出工具气泡、任务彻底完成时触发庆祝动画并推送提示音与系统通知。

---

## 🌟 核心特性

- **即时状态联动**：深度捕获 pi 会话的思考、工具调用与完成事件，实时投递至 LitePet。
- **零延迟非阻塞**：内部采用异步缓冲队列，事件派发完全在后台执行，绝不阻塞 pi 的核心交互与终端渲染。
- **智能提醒机制**：精准区分「中间轮次结束」与「任务彻底收工（settled）」，避免自动重试或排队任务时的重复弹窗与声音打扰。
- **自愈与热插拔**：pi 与 LitePet 守护进程彼此独立，支持任意顺序启动；守护进程重启或临时关闭时，插件会自动重连，无需重启终端。

---

## 📦 安装与加载

### 前置准备
确保 LitePet 守护程序已在后台运行（桌面可见宠物小窗，且存在 `~/.litepet/daemon.json`）。

### 安装方式

```bash
# 方式 1：作为本地插件安装到 pi（推荐，全局生效）
pi install /path/to/pi-plugins-litepet

# 方式 2：在单个会话中临时加载测试（不写入配置文件）
pi -e /path/to/pi-plugins-litepet/src/index.ts

# 方式 3：手动添加至 ~/.pi/agent/settings.json
# {
#   "extensions": ["/path/to/pi-plugins-litepet/src/index.ts"]
# }
```

安装后可在 pi 终端中使用 `pi list` 查看已加载的扩展；卸载可执行 `pi remove pi-plugins-litepet`。

---

## 🎮 终端命令

插件向 pi 注册了便捷的控制台命令：

| 命令 | 说明 |
|---|---|
| `/litepet` | 查看连接状态、当前宠物包 ID、守护进程版本、重连次数及健康状况 |
| `/litepet test` | 命令桌面宠物弹出一个测试气泡，用于快速验证通信链路是否畅通 |

---

## 🔄 事件映射与工作原理

插件将 pi 的扩展钩子平滑映射为 LitePet 标准协议通知：

| pi 内部事件 | 映射的 LitePet RPC | 说明 |
|---|---|---|
| `session_start` | `host/hello` | 建立连接并启动后台保活心跳 |
| `agent_start` | `agent/start` | 宠物切换为「工作/忙碌」动画 |
| `tool_execution_start` | `tool/start` | 宠物头顶弹出当前执行的工具气泡 |
| `tool_execution_end` | `tool/end` | 工具执行完毕，气泡自动退场 |
| `agent_end` | `agent/end` | 单轮推理结束，切换为待机或反馈动画 |
| `agent_settled` | `agent/settled` | 任务彻底收工，触发音效与系统桌面/手机通知 |
| `session_compact` | `pet/bubble` | 气泡提示「上下文已压缩」 |
| `session_shutdown` | `host/bye` | 会话关闭，注销宿主登记 |

### 异步队列保障
所有的网络通信都在专用的轻量 FIFO 队列（`src/dispatch.ts`）中调度执行：
1. **绝不卡顿终端**：所有回调均在入队后立即释放控制权，即使本地网络发生抖动也不影响编码体验。
2. **严格保持时序**：保证 `tool/start` 与 `tool/end` 等配对事件严格按先后顺序送达。
3. **安全容错**：网络超时或异常均在插件内部消化，不污染 pi 进程上下文。

---

## ❓ 常见问题排查

如果在终端输入 `/litepet` 提示异常，可对照下表排查：

| 提示现象 | 可能原因 | 解决办法 |
|---|---|---|
| `未连接`（读不到 daemon.json） | LitePet 守护进程尚未启动 | 启动 LitePet 应用即可，插件会自动恢复连接 |
| `未连接`（connect ECONNREFUSED） | 之前异常关机留下了过期的端点文件 | 重新打开 LitePet 即可覆写最新端点 |
| `HTTP 401，token 不匹配` | 本地 Token 配置不一致 | 检查 `~/.litepet/config.json` 中的 `auth.token` 配置 |
| `HTTP 503` | Token 包含了非 ASCII 字符或空格 | 将 Token 修改为标准英文字符串或留空 |
| `协议版本不兼容` | 守护程序或插件版本差异过大 | 更新插件或重新拉取最新守护程序 |

> 提示：守护程序的详细运行日志位于 `~/.litepet/logs/daemon.log`，方便跟踪事件接收与规则命中细节。

---

## 🛠️ 项目开发与测试

```bash
# 类型检查
npm run typecheck

# 冒烟测试（需 LitePet 守护进程正在运行）
npm run smoke
```
