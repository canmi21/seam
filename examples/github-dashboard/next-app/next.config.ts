/* examples/github-dashboard/next-app/next.config.ts */

import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@github-dashboard/shared"],
};

export default config;
