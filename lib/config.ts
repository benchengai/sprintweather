/** The anonymity threshold. Every number SprintWeather shows is computed over
 * at least k responses, and every theme is backed by at least k notes. */

export const DEFAULT_K = 5;
export const MIN_K = 3;
export const MAX_K = 50;

export class ConfigError extends Error {}

/** Accepts an integer in [MIN_K, MAX_K]; anything else is refused, never clamped,
 * so a typo cannot silently weaken the threshold. */
export function parseK(value: unknown): number {
  const k = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof k !== "number" || !Number.isInteger(k)) {
    throw new ConfigError(`k must be an integer, got ${JSON.stringify(value)}`);
  }
  if (k < MIN_K) throw new ConfigError(`k must be at least ${MIN_K}, got ${k}`);
  if (k > MAX_K) throw new ConfigError(`k must be at most ${MAX_K}, got ${k}`);
  return k;
}

export function kFromEnv(env: Record<string, string | undefined> = process.env): number {
  return env.SW_K === undefined ? DEFAULT_K : parseK(env.SW_K);
}
