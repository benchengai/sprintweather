import type { NextConfig } from "next";

// Two builds from one codebase:
// - local mode (default): route handlers (`route.api.ts`) and a JSON store on disk;
// - demo mode (SW_MODE=demo): a static export over synthetic data, no server and no API key.
// Route handlers only exist in local mode because a static export cannot serve them.
const demo = process.env.SW_MODE === "demo";

const config: NextConfig = {
  output: demo ? "export" : undefined,
  pageExtensions: demo ? ["tsx", "ts"] : ["tsx", "ts", "api.ts"],
  trailingSlash: true,
  images: { unoptimized: true },
  // DEMO_BASE_PATH serves the demo build from a sub-path, e.g. /demos/sprintweather.
  basePath: demo ? (process.env.DEMO_BASE_PATH ?? "") : "",
  env: { NEXT_PUBLIC_SW_MODE: demo ? "demo" : "local" },
  agentRules: false,
};

export default config;
