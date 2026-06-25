/**
 * Token Analytics Controller
 *
 * Express router for token burn analytics.
 * When granularity=hour|day|week is present in the query, the endpoint
 * reads from pre-aggregated AnalyticsBucket rows for improved performance.
 *
 * Issue: #1357
 */

import { Router, Request, Response } from "express";
import { analyticsService, Granularity, TimePeriod } from "./analytics.service";

const router = Router();

const VALID_PERIODS: TimePeriod[] = ["24h", "7d", "30d", "90d", "all"];
const VALID_GRANULARITIES: Granularity[] = ["hour", "day", "week"];

function periodToWindow(period: TimePeriod): { start: Date; end: Date } {
  const now = new Date();
  switch (period) {
    case "24h":
      return { start: new Date(Date.now() - 24 * 3_600_000), end: now };
    case "7d":
      return { start: new Date(Date.now() - 7 * 86_400_000), end: now };
    case "30d":
      return { start: new Date(Date.now() - 30 * 86_400_000), end: now };
    case "90d":
      return { start: new Date(Date.now() - 90 * 86_400_000), end: now };
    case "all":
    default:
      return { start: new Date("2020-01-01"), end: now };
  }
}

/**
 * GET /api/token-analytics/:address
 *
 * Query params:
 *   period      - "24h" | "7d" | "30d" | "90d" | "all"  (default: "7d")
 *   granularity - "hour" | "day" | "week"                (optional)
 *
 * When granularity is provided, returns pre-aggregated bucket rows
 * instead of the full analytics response (10-100x faster for busy tokens).
 */
router.get("/:address", async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const rawPeriod = (req.query.period as string) ?? "7d";
    const rawGranularity = req.query.granularity as string | undefined;

    const period: TimePeriod = VALID_PERIODS.includes(rawPeriod as TimePeriod)
      ? (rawPeriod as TimePeriod)
      : "7d";

    if (rawGranularity !== undefined) {
      if (!VALID_GRANULARITIES.includes(rawGranularity as Granularity)) {
        return res.status(400).json({
          error: `Invalid granularity. Must be one of: ${VALID_GRANULARITIES.join(", ")}`,
        });
      }

      const granularity = rawGranularity as Granularity;
      const { start, end } = periodToWindow(period);
      const buckets = await analyticsService.getBuckets(
        address.toLowerCase(),
        granularity,
        start,
        end
      );
      return res.json(buckets);
    }

    const data = await analyticsService.getTokenAnalytics(address, period);
    return res.json(data);
  } catch (err: any) {
    if (err?.status === 404) {
      return res.status(404).json({ error: err.message });
    }
    console.error("[analytics] unexpected error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
