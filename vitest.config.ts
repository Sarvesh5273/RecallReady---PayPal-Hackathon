import { defineConfig } from "vitest/config";
import "dotenv/config";
import { fileURLToPath } from "node:url";
const resolve = {
  alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
};
export default defineConfig({
  resolve,
  test: {
    projects: [
      {
        resolve,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
          environment: "node",
        },
      },
      {
        resolve,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
          testTimeout: 20000,
          hookTimeout: 20000,
          env: {
            DATABASE_URL:
              process.env.TEST_DATABASE_URL ??
              "postgresql://recallready:local_only_password@localhost:54329/recallready_test",
          },
        },
      },
    ],
  },
});
