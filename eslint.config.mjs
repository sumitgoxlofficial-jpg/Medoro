import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", "node_modules/**", "design/**", "desktop/**", "public/drivedb/sqlite/**", "public/tour/**", "next-env.d.ts"] },
  ...nextVitals,
  ...nextTs,
  {
    // Pages and layouts here are server components (none is "use client"): they render once per request on the server,
    // so reading the clock (e.g. "sessions seen in the last 5 minutes") is correct and there is no hydration to mismatch.
    files: ["src/app/**/page.tsx", "src/app/**/layout.tsx"],
    rules: { "react-hooks/purity": "off" },
  },
];

export default config;
