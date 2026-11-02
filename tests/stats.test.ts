import { describe, expect, it } from "vitest";

import { meanInterval, tQuantile, welchInterval, wilsonInterval } from "@/lib/stats";

describe("statistics", () => {
  it("matches published Student-t quantiles", () => {
    expect(tQuantile(0.975, 1)).toBeCloseTo(12.706, 2);
    expect(tQuantile(0.975, 10)).toBeCloseTo(2.228, 3);
    expect(tQuantile(0.975, 30)).toBeCloseTo(2.042, 3);
    expect(tQuantile(0.975, 1000)).toBeCloseTo(1.962, 3);
  });

  it("computes a mean interval", () => {
    const ci = meanInterval([2, 4, 4, 4, 5, 5, 7, 9])!;
    expect(ci.estimate).toBe(5);
    // s = 2.138, se = 0.756, t(0.975, 7) = 2.365
    expect(ci.lo).toBeCloseTo(3.212, 2);
    expect(ci.hi).toBeCloseTo(6.788, 2);
  });

  it("computes Welch's interval with Welch-Satterthwaite degrees of freedom", () => {
    const ci = welchInterval([1, 2, 3, 4, 5], [3, 4, 5, 6, 7, 8, 9])!;
    expect(ci.estimate).toBeCloseTo(3, 6);
    expect(ci.df).toBeCloseTo(9.966, 2);
    expect(ci.lo).toBeCloseTo(0.6, 1);
    expect(ci.hi).toBeCloseTo(5.4, 1);
    expect(welchInterval([3], [4, 5])).toBeNull();
  });

  it("computes a Wilson interval", () => {
    const ci = wilsonInterval(3, 16);
    expect(ci.lo).toBeCloseTo(0.0659, 3);
    expect(ci.hi).toBeCloseTo(0.4302, 3);
    expect(wilsonInterval(0, 10).lo).toBe(0);
  });
});
