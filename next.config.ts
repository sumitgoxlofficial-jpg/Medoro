import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@node-rs/argon2", "pg"],
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
};

export default nextConfig;
