import { defineConfig } from "vitest/config";
import base from "./vitest.config.mts";

// Load tests: `pnpm test:load`. Not part of the normal run (they take minutes and print timings).
export default defineConfig({ ...base, test: { ...base.test, include: ["tests/load/**/*.load.ts"], testTimeout: 600_000, hookTimeout: 600_000 } });
