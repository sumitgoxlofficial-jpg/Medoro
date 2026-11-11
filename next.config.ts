import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  serverExternalPackages: ["@node-rs/argon2", "pg", "baileys"],
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: "11mb", allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) } },
  outputFileTracingIncludes: { "/api/ready": ["./prisma/migrations/**/*"] },
  // Short addresses for the team sign-in pages. They are not linked from the public site: staff use these directly.
  async redirects() {
    return [{ source: "/hrms", destination: "/staff/employee", permanent: false }];
  },
  async headers() {
    return [{ source: "/_next/static/:path*", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }] }];
  },
};

export default nextConfig;