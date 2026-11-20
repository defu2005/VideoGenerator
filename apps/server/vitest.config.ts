import { defineConfig } from "vitest/config";

// The preview budget tests time real ffmpeg/browser work. Under the full
// parallel suite they breached their budgets (frame 5.8 s vs 3 s) because
// ~200 other files shared the CPU. Run them alone, after the rest of the
// suite, so the budgets measure the code rather than the machine load.
const PREVIEW_BUDGET_FILE = "test/preview.test.ts";

// Timing-sensitive files also run serially: under the parallel suite the child-process
// heartbeat test missed heartbeats and visualReuse hit its 30 s timeout (cause not confirmed).
const SERIAL_FILES = ["test/workerKeepAlive.test.ts", "test/visualReuse.test.ts"];

const shared = {
  environment: "node",
  testTimeout: 30_000,
  hookTimeout: 30_000,
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          ...shared,
          name: "parallel",
          include: ["test/**/*.test.ts"],
          exclude: [PREVIEW_BUDGET_FILE, ...SERIAL_FILES],
          sequence: { groupOrder: 1 },
        },
      },
      {
        test: {
          ...shared,
          name: "preview-budgets",
          include: [PREVIEW_BUDGET_FILE, ...SERIAL_FILES],
          fileParallelism: false,
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
});
