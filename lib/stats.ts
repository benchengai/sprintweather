/** Small, dependency-free statistics: means, Student-t intervals and Welch's
 * interval for a difference in means. */

export function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample variance (n - 1 denominator). */
export function variance(xs: number[]): number {
  const m = mean(xs);
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
}

function logGamma(x: number): number {
  // Lanczos approximation (g = 7, n = 9).
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the regularised incomplete beta function. */
function betacf(a: number, b: number, x: number): number {
  const eps = 1e-14;
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < eps) break;
  }
  return h;
}

function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betacf(a, b, x)) / a : 1 - (front * betacf(b, a, 1 - x)) / b;
}

/** P(T <= t) for Student's t with df degrees of freedom (df may be fractional). */
export function tCdf(t: number, df: number): number {
  const p = 0.5 * incompleteBeta(df / 2, 0.5, df / (df + t * t));
  return t >= 0 ? 1 - p : p;
}

/** Quantile of Student's t, by bisection on the CDF. */
export function tQuantile(p: number, df: number): number {
  let lo = -1e3;
  let hi = 1e3;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface Interval {
  estimate: number;
  lo: number;
  hi: number;
}

/** 95% t-interval for a mean. */
export function meanInterval(xs: number[]): Interval | null {
  if (xs.length < 2) return null;
  const m = mean(xs);
  const half = tQuantile(0.975, xs.length - 1) * Math.sqrt(variance(xs) / xs.length);
  return { estimate: m, lo: m - half, hi: m + half };
}

/** Welch's 95% interval for mean(after) - mean(before). Assumes independent
 * samples; see docs/privacy-model.md for why that is only approximately true here. */
export function welchInterval(before: number[], after: number[]): (Interval & { df: number }) | null {
  if (before.length < 2 || after.length < 2) return null;
  const va = variance(before) / before.length;
  const vb = variance(after) / after.length;
  const diff = mean(after) - mean(before);
  const se = Math.sqrt(va + vb);
  if (se === 0) return { estimate: diff, lo: diff, hi: diff, df: before.length + after.length - 2 };
  const df = (va + vb) ** 2 / (va ** 2 / (before.length - 1) + vb ** 2 / (after.length - 1));
  const half = tQuantile(0.975, df) * se;
  return { estimate: diff, lo: diff - half, hi: diff + half, df };
}
