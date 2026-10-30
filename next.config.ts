import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  serverExternalPackages: ["@node-rs/argon2", "pg"],
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: "11mb", allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) } },
  outputFileTracingIncludes: { "/api/ready": ["./prisma/migrations/**/*"] },
  async headers() {
    return [{ source: "/_next/static/:path*", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }] }];
  },
};

export default nextConfig;