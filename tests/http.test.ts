import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { PayloadTooLargeError, clientIpFromHeaders, readJsonWithLimit, readTextWithLimit } from "@/lib/http";

function post(body: string) {
  return new Request("http://localhost/api/test", { method: "POST", body, headers: { "Content-Type": "application/json" } });
}

describe("请求体上限", () => {
  it("超过上限时返回 PayloadTooLargeError", async () => {
    await expect(readTextWithLimit(post("x".repeat(101)), 100)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("恰好等于上限可以读取，多字节内容按字节计算", async () => {
    expect(await readTextWithLimit(post("a".repeat(100)), 100)).toHaveLength(100);
    await expect(readTextWithLimit(post("中".repeat(34)), 100)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("解析 JSON 并保留空体与格式错误的区分", async () => {
    expect(await readJsonWithLimit(post("{\"ok\":true}"), { maxBytes: 100 })).toEqual({ ok: true });
    await expect(readJsonWithLimit(post(""), { maxBytes: 100 })).rejects.toBeInstanceOf(AppError);
    expect(await readJsonWithLimit(post(""), { maxBytes: 100, allowEmpty: true })).toBeUndefined();
    await expect(readJsonWithLimit(post("{"), { maxBytes: 100 })).rejects.toThrow("JSON 格式无效");
  });

  it("优先取 x-forwarded-for 首个地址", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });
});
