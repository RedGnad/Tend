import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  transpilePackages: ["@tend/shared"],
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
