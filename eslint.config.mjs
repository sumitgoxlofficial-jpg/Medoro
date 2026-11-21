import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", "node_modules/**", "design/**", "desktop/**", "public/drivedb/sqlite/**", "public/tour/**", "next-env.d.ts"] },
  ...nextVitals,
  ...nextTs,
  {
    // React Compiler rules that arrived with eslint-config-next 16 (eslint-plugin-react-hooks 7). The code predates them
    // and passed lint under Next.js 15; they are reported as warnings until the call sites are reworked (see
    // docs/audit/MEDORO_BUG_FIX_LOG.md, BUG-10), so they stay visible without blocking CI.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
];

export default config;
