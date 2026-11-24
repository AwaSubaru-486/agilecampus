import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { AppError } from "./errors";

/**
 * 模型服务地址的安全边界。
 *
 * 个人 API 配置允许用户填写任意服务地址，而服务端会主动向该地址发起请求。
 * 如果放行回环、内网、链路本地或云元数据地址，任何登录用户都能借服务器探测
 * 内网（SSRF）。这里在保存和每次请求前都做检查；请求时还会解析域名，拒绝
 * 解析到内网的域名。
 *
 * 已知残余风险：域名解析与实际连接之间仍有极短的 DNS 重绑定窗口。这里通过
 * 禁止重定向（redirect: "error"）和逐请求解析把风险压到最低，但不宣称能完全
 * 消除。确实需要连接内网自建模型时，用 MODEL_ALLOW_PRIVATE_NETWORK=1 显式开启。
 */

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home.arpa",
  ".intranet",
  ".corp",
];

function allowPrivateNetwork() {
  return process.env.MODEL_ALLOW_PRIVATE_NETWORK === "1";
}

function stripIpv6Brackets(hostname: string) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function parseIpv4(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (numbers.some((part) => !Number.isFinite(part) || part > 255)) return null;
  return ((numbers[0] << 24) | (numbers[1] << 16) | (numbers[2] << 8) | numbers[3]) >>> 0;
}

const BLOCKED_IPV4_RANGES: Array<[number, number, string]> = [
  [0x00000000, 0x00ffffff, "本网络"],
  [0x0a000000, 0x0affffff, "私有网络"],
  [0x64400000, 0x647fffff, "运营商级 NAT"],
  [0x7f000000, 0x7fffffff, "回环地址"],
  [0xa9fe0000, 0xa9feffff, "链路本地/云元数据"],
  [0xac100000, 0xac1fffff, "私有网络"],
  [0xc0000000, 0xc00000ff, "保留地址"],
  [0xc0000200, 0xc00002ff, "文档地址"],
  [0xc0a80000, 0xc0a8ffff, "私有网络"],
  [0xc6120000, 0xc613ffff, "基准测试地址"],
  [0xc6336400, 0xc63364ff, "文档地址"],
  [0xcb007100, 0xcb0071ff, "文档地址"],
  [0xe0000000, 0xefffffff, "组播地址"],
  [0xf0000000, 0xffffffff, "保留地址"],
];

function blockedIpv4(value: number): boolean {
  return BLOCKED_IPV4_RANGES.some(([start, end]) => value >= start && value <= end);
}

function isBlockedIpv4(value: string) {
  const parsed = parseIpv4(value);
  return parsed === null || blockedIpv4(parsed);
}

/** 展开 IPv6 为 8 个 16 位分组；格式不合法时返回 null。 */
function expandIpv6(raw: string): number[] | null {
  let value = raw.toLowerCase();
  const zone = value.indexOf("%");
  if (zone >= 0) value = value.slice(0, zone);

  // 先把末尾的 IPv4 点分形式换成两个十六进制分组，再按 :: 展开。
  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    if (lastColon < 0) return null;
    const embedded = parseIpv4(value.slice(lastColon + 1));
    if (embedded === null) return null;
    value = `${value.slice(0, lastColon + 1)}${(embedded >>> 16).toString(16)}:${(embedded & 0xffff).toString(16)}`;
  }

  const [leftRaw, rightRaw, extra] = value.split("::");
  if (extra !== undefined) return null;
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  const compressed = value.includes("::");
  const missing = 8 - left.length - right.length;
  if (compressed ? missing < 0 : missing !== 0) return null;

  const groups = [...left, ...Array.from({ length: Math.max(0, missing) }, () => "0"), ...right];
  if (groups.length !== 8) return null;
  const numbers = groups.map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN));
  return numbers.every((number) => Number.isFinite(number)) ? numbers : null;
}

function isBlockedIpv6(raw: string): boolean {
  const groups = expandIpv6(raw);
  if (!groups) return true;

  const ipv4 = (((groups[6] << 16) | groups[7]) >>> 0);
  const zeroPrefix = groups.slice(0, 5).every((group) => group === 0);

  if (groups.every((group) => group === 0)) return true; // ::
  if (zeroPrefix && groups[5] === 0 && groups[6] === 0 && groups[7] === 1) return true; // ::1
  // IPv4 映射/兼容地址（URL 会规范化成 ::ffff:7f00:1 这类形式）。
  if (zeroPrefix && (groups[5] === 0xffff || groups[5] === 0)) return blockedIpv4(ipv4);
  // NAT64 64:ff9b::/96 同样可能指向内网 IPv4。
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((group) => group === 0)) return blockedIpv4(ipv4);

  const first = groups[0];
  if (first >= 0xfc00 && first <= 0xfdff) return true; // fc00::/7
  if (first >= 0xfe80 && first <= 0xfebf) return true; // fe80::/10
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8
  if (first === 0x2001 && groups[1] === 0x0db8) return true; // 文档地址
  return false;
}

/** 判断一个 IP 字面量是否属于内网、回环、链路本地、组播或保留地址。 */
export function isBlockedAddress(address: string) {
  const value = stripIpv6Brackets(address.trim());
  const family = isIP(value);
  if (family === 4) return isBlockedIpv4(value);
  if (family === 6) return isBlockedIpv6(value);
  return false;
}

function isBlockedHostname(hostname: string) {
  const host = stripIpv6Brackets(hostname).toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (isIP(host)) return isBlockedAddress(host);
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  // 单标签主机名（如 metadata、ollama）通常只在内网解析，默认拒绝。
  if (!host.includes(".")) return true;
  return false;
}

function normalizedUrl(value: string): URL | null {
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

/**
 * 同步检查模型服务地址是否合法且不指向本机/内网。
 * 返回可直接展示给用户的问题描述，合法时返回 null。
 */
export function modelBaseUrlIssue(value: string): string | null {
  const url = normalizedUrl(value);
  if (!url) return "填写有效的 HTTP 或 HTTPS API 地址";
  if (!["http:", "https:"].includes(url.protocol)) return "只支持 HTTP 或 HTTPS API 地址";
  if (url.username || url.password) return "API 地址不能包含账号或密码";
  if (url.search || url.hash) return "API 地址不能包含查询参数或锚点";
  if (!url.hostname) return "API 地址缺少主机名";
  if (!allowPrivateNetwork()) {
    if (isBlockedHostname(url.hostname)) return "模型服务地址不能指向本机、内网或保留地址";
  }
  return null;
}

export function assertSafeModelBaseUrl(value: string): URL {
  const issue = modelBaseUrlIssue(value);
  if (issue) throw new AppError(issue);
  return new URL(value.trim());
}

/**
 * 请求前解析域名，拒绝任何解析到内网的结果。
 * 仅在使用默认安全策略时生效；显式允许内网时跳过。
 */
export async function assertResolvedPublicHost(hostname: string): Promise<void> {
  if (allowPrivateNetwork()) return;
  const host = stripIpv6Brackets(hostname);
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new AppError("模型服务地址不能指向本机或内网");
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new AppError("模型服务地址无法解析，请检查域名");
  }
  if (!addresses.length) throw new AppError("模型服务地址无法解析，请检查域名");
  if (addresses.some((item) => isBlockedAddress(item.address))) {
    throw new AppError("模型服务地址解析到本机或内网，已拒绝请求");
  }
}

/**
 * 给模型 SDK 使用的 fetch：每次请求前校验目标地址并禁止重定向，
 * 避免通过 302 跳到内网或云元数据地址。
 */
export async function guardedModelFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const target = input instanceof Request ? input.url : input instanceof URL ? input.toString() : String(input);
  const url = assertSafeModelBaseUrl(target);
  await assertResolvedPublicHost(url.hostname);
  return fetch(input, { ...init, redirect: "error" });
}
