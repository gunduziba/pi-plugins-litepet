/**
 * 端点发现：家目录 → `daemon.json` → `{protocolVersion, port, token}`。
 *
 * 家目录布局与常量全部取自 `litepet-adapter-ts`（`HOME_ENV` / `HOME_DIR_NAME` /
 * `ENDPOINT_FILE`），不在这里另抄一份——抄一份就等于多一处会漂移的地方。
 *
 * **本文件不启动 daemon**：读不到就返回 `null`，由调用方决定下一步
 * （本插件选择静默放弃，理由见 `README.md`）。
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  ENDPOINT_FILE,
  HOME_DIR_NAME,
  HOME_ENV,
  PROTOCOL_VERSION,
  type DaemonEndpoint,
  type EndpointLocation,
} from "litepet-adapter-ts";

/**
 * 解析家目录与端点文件路径。
 *
 * `LITEPET_HOME` 非空时用它，否则 `~/.litepet`——与 daemon 侧同一套规则
 * （daemon 的 `config.rs` 也用这个环境变量）。
 *
 * @param env 环境变量表；默认 `process.env`，给单测留出注入点。
 * @returns 家目录与 `daemon.json` 的绝对路径。
 */
export function locateEndpoint(
  env: Readonly<Record<string, string | undefined>> = process.env,
): EndpointLocation {
  const override = env[HOME_ENV];
  const home =
    override !== undefined && override.trim() !== ""
      ? override
      : join(homedir(), HOME_DIR_NAME);
  return { home, endpointFile: join(home, ENDPOINT_FILE) };
}

/**
 * 读并校验端点文件。
 *
 * 任何一步不通都返回 `null`（文件不存在、读不动、不是 JSON、字段类型不对），
 * **不抛错**：宠物不在线不该让宿主报错。
 *
 * @param env 环境变量表；默认 `process.env`。
 * @returns 合法端点，或 `null`。
 */
export async function readEndpoint(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<DaemonEndpoint | null> {
  const { endpointFile } = locateEndpoint(env);

  let raw: string;
  try {
    raw = await readFile(endpointFile, "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  return normalizeEndpoint(parsed);
}

/**
 * 字段校验。
 *
 * 判「能不能连」**只看 `port`**：`token` 允许是空串（空 = 不鉴权），
 * 不能按它的真值判端点是否完整——这是 daemon 文档明确警告过的坑。
 *
 * `protocolVersion` 不是数字时按当前协议版本处理，与 daemon 侧
 * `host/hello` 对缺省字段的处理保持一致（缺省视为当前版本）。
 *
 * @param value `JSON.parse` 出来的任意值。
 * @returns 合法端点，或 `null`。
 */
function normalizeEndpoint(value: unknown): DaemonEndpoint | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;

  const port = record.port;
  if (typeof port !== "number" || !Number.isInteger(port) || port <= 0 || port > 65535) {
    return null;
  }

  const protocolVersion = record.protocolVersion;
  const token = record.token;

  return {
    protocolVersion: typeof protocolVersion === "number" ? protocolVersion : PROTOCOL_VERSION,
    port,
    token: typeof token === "string" ? token : "",
  };
}
