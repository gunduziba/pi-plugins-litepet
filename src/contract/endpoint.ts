/**
 * daemon 端点发现约定：家目录布局与 `daemon.json` 结构。
 *
 * **本文件不读文件**——「怎么读、读不到怎么办（要不要拉起 daemon、重试几次）」
 * 属于宿主的实现自由，见 `README.md`。
 */

/** 覆盖家目录的环境变量。未设置时默认 `~/.litepet`。 */
export const HOME_ENV = "LITEPET_HOME";

/** 家目录默认名（位于用户 home 下）。 */
export const HOME_DIR_NAME = ".litepet";

/** 端点文件名，位于家目录下。 */
export const ENDPOINT_FILE = "daemon.json";

/** 配置文件文件名，位于家目录下。 */
export const CONFIG_FILE = "config.json";

/** 宠物包目录名，位于家目录下。 */
export const PETS_DIR = "pets";

/**
 * `~/.litepet/daemon.json` 的结构：运行中的 daemon 的对接信息。
 *
 * 宿主读这个文件就知道该往哪个端口、带哪个 token 发 JSON-RPC，
 * 因此端口改到非默认值也不会让宿主迷失。
 *
 * **`token` 来自用户配置**（`config.json` 的 `auth.token`）：多次启动之间稳定，
 * 并且**可以为空串**——空串表示关掉了鉴权，此时请求不带 `Authorization` 头。
 *
 * 所以**不要按 `token` 的真值判断端点能不能用**：只看 `port` 是不是数字。
 *
 * daemon 异常退出可能残留该文件，此时里面的端口已无人监听——
 * 宿主连不上自然会重新拉起 daemon，不必先删文件。
 */
export interface DaemonEndpoint {
  /** daemon 声明的协议版本。 */
  readonly protocolVersion: number;
  /** HTTP 端口。 */
  readonly port: number;
  /**
   * 访问密钥（用户自定口令，不是随机生成的十六进制串）。
   *
   * 非空时以 `Authorization: Bearer <token>` 发送；空串表示不鉴权，不要带头。
   * 与配置里声明的值不符时 daemon 回 HTTP 401，不是 JSON-RPC 错误码。
   */
  readonly token: string;
}

/** 端点文件路径可能被 `LITEPET_HOME` 覆盖，宿主必须走同一套解析规则。 */
export interface EndpointLocation {
  /** 家目录绝对路径。 */
  readonly home: string;
  /** `daemon.json` 绝对路径。 */
  readonly endpointFile: string;
}
