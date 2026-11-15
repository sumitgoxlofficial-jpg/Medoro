import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  serverExternalPackages: ["@node-rs/argon2", "pg", "baileys"],
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: "11mb", allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) } },
  outputFileTracingIncludes: { "/api/ready": ["./prisma/migrations/**/*"] },
  // Short addresses for the team sign-in pages. They are not linked from the public site: staff use these directly.
  async redirects() {
    return [
      { source: "/hrms", destination: "/staff/employee", permanent: false },
      // Local SEO pages live at /pharmacy-software-in-<place> (rewritten below); the route's own address points there.
      { source: "/pharmacy-software-in/:location", destination: "/pharmacy-software-in-:location", permanent: true },
    ];
  },
  // The App Router can't put a parameter inside a segment ("pharmacy-software-in-[location]"), so the public address
  // is rewritten to src/app/pharmacy-software-in/[location]. Real routes (e.g. /pharmacy-software-in-india) win first.
  async rewrites() {
    return [{ source: "/pharmacy-software-in-:location", destination: "/pharmacy-software-in/:location" }];
  },
  async headers() {
    return [{ source: "/_next/static/:path*", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }] }];
  },
};

export default nextConfig;