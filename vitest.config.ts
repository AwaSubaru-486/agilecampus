import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["./tests/setup.ts"],
    fileParallelism: false, // 共享测试库，串行执行避免数据互踩
    maxWorkers: 1,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
