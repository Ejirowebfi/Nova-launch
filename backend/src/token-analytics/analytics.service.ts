/**
 * Token Analytics Service
 *
 * Provides burn analytics for individual tokens with a pre-aggregated
 * time-bucket pipeline to avoid full-table scans on high-activity tokens.
 *
 * Issue: #1357
 */

import { prisma } from "../lib/prisma";
import { Prisma } from "@prisma/client";

export type Granularity = "hour" | "day" | "week";

export interface PeriodStats {
  volume: string;
  count: number;
  uniqueBurners: number;
}

export interface TimeSeriesDataPoint {
  timestamp: string;
  value: string;
  count: number;
}

export interface BurnTypeDistribution {
  self: string;
  admin: string;
  selfPercentage: number;
  adminPercentage: number;
}

export interface TokenAnalyticsResponseDto {
  tokenAddress: string;
  period: string;
  generatedAt: string;

  // All-time
  totalBurned: string;
  totalBurnCount: number;
  allTimeUniqueBurners: number;
  largestBurn: string;
  largestBurnTx: string;

  // Fixed-window stats
  stats24h: PeriodStats;
  stats7d: PeriodStats;
  stats30d: PeriodStats;

  // Current period
  periodVolume: string;
  periodBurnCount: number;
  periodUniqueBurners: number;
  averageBurnAmount: string;
  burnFrequencyPerDay: number;

  // Comparison vs previous period
  volumeChangePercent: number;
  countChangePercent: number;

  // Chart data
  timeSeries: TimeSeriesDataPoint[];
  burnTypeDistribution: BurnTypeDistribution;
}

export interface BucketQueryResult {
  bucketStart: Date;
  granularity: string;
  burnVolume: string;
  transferCount: number;
  holderCount: number;
}

/** Shape of an analytics event passed into aggregateIntoBuckets */
export interface AnalyticsEvent {
  tokenId: string;
  burnVolume: bigint;
  transferCount?: number;
  holderCount?: number;
  eventTime: Date;
}

interface PeriodWindow {
  start: Date;
  end: Date;
  granularity: "hour" | "day" | "week" | "month";
  intervalCount: number;
}

export type TimePeriod = "24h" | "7d" | "30d" | "90d" | "all";

const GRANULARITIES: Granularity[] = ["hour", "day", "week"];

// ──────────────────────────────────────────────────────────────────────────────
// Injectable prisma dependency for testability
// ──────────────────────────────────────────────────────────────────────────────

type PrismaDep = Pick<typeof prisma, "analyticsBucket">;

export class AnalyticsService {
  private readonly db: PrismaDep;

  constructor(db?: PrismaDep) {
    this.db = db ?? prisma;
  }

  // ──────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────

  async getTokenAnalytics(
    tokenAddress: string,
    period: TimePeriod
  ): Promise<TokenAnalyticsResponseDto> {
    const normalizedAddress = tokenAddress.toLowerCase();

    // Verify token has any burns at all
    const exists = await this.countBurnEvents(normalizedAddress);
    if (exists === 0) {
      const err = new Error(`No burn data found for token ${tokenAddress}`);
      (err as any).status = 404;
      throw err;
    }

    const window = this.getPeriodWindow(period);
    const prevWindow = this.getPreviousWindow(window);

    const [
      allTimeStats,
      periodBurns,
      prevPeriodBurns,
      stats24h,
      stats7d,
      stats30d,
      timeSeries,
      burnTypeDistribution,
      largestBurnRow,
    ] = await Promise.all([
      this.getAllTimeStats(normalizedAddress),
      this.getPeriodStats(normalizedAddress, window.start, window.end),
      this.getPeriodStats(normalizedAddress, prevWindow.start, prevWindow.end),
      this.getPeriodStats(normalizedAddress, this.hoursAgo(24), new Date()),
      this.getPeriodStats(normalizedAddress, this.daysAgo(7), new Date()),
      this.getPeriodStats(normalizedAddress, this.daysAgo(30), new Date()),
      this.buildTimeSeries(normalizedAddress, window),
      this.getBurnTypeDistribution(normalizedAddress, window.start, window.end),
      this.getLargestBurn(normalizedAddress),
    ]);

    const volumeChangePercent = this.calcChangePercent(
      BigInt(prevPeriodBurns.volume),
      BigInt(periodBurns.volume)
    );
    const countChangePercent = this.calcChangePercent(
      BigInt(prevPeriodBurns.count),
      BigInt(periodBurns.count)
    );

    const durationDays = this.windowDurationDays(window);
    const burnFrequencyPerDay =
      durationDays > 0
        ? Math.round((periodBurns.count / durationDays) * 100) / 100
        : 0;

    const averageBurnAmount =
      periodBurns.count > 0
        ? (BigInt(periodBurns.volume) / BigInt(periodBurns.count)).toString()
        : "0";

    return {
      tokenAddress,
      period,
      generatedAt: new Date().toISOString(),

      // All-time
      totalBurned: allTimeStats.totalVolume,
      totalBurnCount: allTimeStats.totalCount,
      allTimeUniqueBurners: allTimeStats.uniqueBurners,
      largestBurn: largestBurnRow?.amount ?? "0",
      largestBurnTx: largestBurnRow?.txHash ?? "",

      // Fixed-window stats
      stats24h,
      stats7d,
      stats30d,

      // Current period
      periodVolume: periodBurns.volume,
      periodBurnCount: periodBurns.count,
      periodUniqueBurners: periodBurns.uniqueBurners,
      averageBurnAmount,
      burnFrequencyPerDay,

      // Comparison
      volumeChangePercent,
      countChangePercent,

      // Chart
      timeSeries,
      burnTypeDistribution,
    };
  }

  /**
   * Upsert pre-aggregated AnalyticsBucket rows for all three granularities
   * (hour, day, week) on every new analytics event.
   *
   * Called after each new burn/transfer event is persisted so that the
   * buckets stay current without needing a full table scan.
   */
  async aggregateIntoBuckets(event: AnalyticsEvent): Promise<void> {
    const ops = GRANULARITIES.map((gran) => {
      const bucketStart = this.truncateToBucket(event.eventTime, gran);
      return this.db.analyticsBucket.upsert({
        where: {
          tokenId_bucketStart_granularity: {
            tokenId: event.tokenId,
            bucketStart,
            granularity: gran,
          },
        },
        create: {
          tokenId: event.tokenId,
          bucketStart,
          granularity: gran,
          burnVolume: event.burnVolume,
          transferCount: event.transferCount ?? 0,
          holderCount: event.holderCount ?? 0,
        },
        update: {
          burnVolume: {
            increment: event.burnVolume,
          },
          transferCount: {
            increment: event.transferCount ?? 0,
          },
          holderCount: {
            increment: event.holderCount ?? 0,
          },
        },
      });
    });

    await Promise.all(ops);
  }

  /**
   * Paginated backfill: scans existing burn_events for the given tokenId
   * and populates AnalyticsBucket rows for all granularities.
   *
   * Designed for first-run scenarios.  Each page is processed in sequence
   * to avoid overwhelming the database.
   */
  async backfillBuckets(
    tokenId: string,
    pageSize = 500
  ): Promise<{ pagesProcessed: number; eventsProcessed: number }> {
    let skip = 0;
    let pagesProcessed = 0;
    let eventsProcessed = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const rows = await this.queryBurnEventsPage(tokenId, pageSize, skip);

      if (rows.length === 0) break;

      // Group by bucket boundaries for each granularity to minimise upserts
      const bucketMap = new Map<
        string,
        {
          tokenId: string;
          bucketStart: Date;
          granularity: string;
          burnVolume: bigint;
          transferCount: number;
        }
      >();

      for (const row of rows) {
        const eventTime = new Date(row.burned_at);
        const volume = BigInt(row.amount);

        for (const gran of GRANULARITIES) {
          const bucketStart = this.truncateToBucket(eventTime, gran);
          const key = `${tokenId}:${gran}:${bucketStart.toISOString()}`;
          const existing = bucketMap.get(key);
          if (existing) {
            existing.burnVolume += volume;
            existing.transferCount += 1;
          } else {
            bucketMap.set(key, {
              tokenId,
              bucketStart,
              granularity: gran,
              burnVolume: volume,
              transferCount: 1,
            });
          }
        }
      }

      // Upsert all accumulated buckets from this page
      await Promise.all(
        Array.from(bucketMap.values()).map((b) =>
          this.db.analyticsBucket.upsert({
            where: {
              tokenId_bucketStart_granularity: {
                tokenId: b.tokenId,
                bucketStart: b.bucketStart,
                granularity: b.granularity,
              },
            },
            create: {
              tokenId: b.tokenId,
              bucketStart: b.bucketStart,
              granularity: b.granularity,
              burnVolume: b.burnVolume,
              transferCount: b.transferCount,
              holderCount: 0,
            },
            update: {
              burnVolume: { increment: b.burnVolume },
              transferCount: { increment: b.transferCount },
            },
          })
        )
      );

      eventsProcessed += rows.length;
      pagesProcessed += 1;
      skip += pageSize;

      if (rows.length < pageSize) break;
    }

    return { pagesProcessed, eventsProcessed };
  }

  /**
   * Query pre-aggregated buckets for a given token, granularity, and window.
   * Used by the controller when a granularity query param is present.
   */
  async getBuckets(
    tokenId: string,
    granularity: Granularity,
    start: Date,
    end: Date
  ): Promise<BucketQueryResult[]> {
    const rows = await this.db.analyticsBucket.findMany({
      where: {
        tokenId,
        granularity,
        bucketStart: { gte: start, lt: end },
      },
      orderBy: { bucketStart: "asc" },
    });

    return rows.map((r) => ({
      bucketStart: r.bucketStart,
      granularity: r.granularity,
      burnVolume: r.burnVolume.toString(),
      transferCount: r.transferCount,
      holderCount: r.holderCount,
    }));
  }

  // ──────────────────────────────────────────────
  // Query helpers (mockable via subclass or vi.spyOn in tests)
  // ──────────────────────────────────────────────

  /** Overridable for tests that don't want to spin up a real DB. */
  protected async countBurnEvents(tokenAddress: string): Promise<number> {
    const result = await prisma.$queryRaw<[{ cnt: bigint }]>`
      SELECT COUNT(*)::int AS cnt FROM burn_events WHERE token_address = ${tokenAddress}
    `;
    return Number(result[0].cnt);
  }

  protected async queryBurnEventsPage(
    tokenAddress: string,
    pageSize: number,
    skip: number
  ): Promise<{ amount: string; burned_at: Date }[]> {
    return prisma.$queryRaw<{ amount: string; burned_at: Date }[]>`
      SELECT amount, burned_at
      FROM burn_events
      WHERE token_address = ${tokenAddress}
      ORDER BY burned_at ASC
      LIMIT ${pageSize} OFFSET ${skip}
    `;
  }

  private async getAllTimeStats(tokenAddress: string): Promise<{
    totalVolume: string;
    totalCount: number;
    uniqueBurners: number;
  }> {
    const rows = await prisma.$queryRaw<
      { totalVolume: string; totalCount: number; uniqueBurners: number }[]
    >`
      SELECT
        COALESCE(SUM(amount::numeric), 0)::text AS "totalVolume",
        COUNT(*)::int                           AS "totalCount",
        COUNT(DISTINCT burner_address)::int     AS "uniqueBurners"
      FROM burn_events
      WHERE token_address = ${tokenAddress}
    `;
    return rows[0];
  }

  private async getPeriodStats(
    tokenAddress: string,
    start: Date,
    end: Date
  ): Promise<PeriodStats> {
    const rows = await prisma.$queryRaw<PeriodStats[]>`
      SELECT
        COALESCE(SUM(amount::numeric), 0)::text AS volume,
        COUNT(*)::int                           AS count,
        COUNT(DISTINCT burner_address)::int     AS "uniqueBurners"
      FROM burn_events
      WHERE token_address = ${tokenAddress}
        AND burned_at >= ${start}
        AND burned_at < ${end}
    `;
    return rows[0];
  }

  private async getLargestBurn(
    tokenAddress: string
  ): Promise<{ amount: string; txHash: string } | null> {
    const rows = await prisma.$queryRaw<{ amount: string; txHash: string }[]>`
      SELECT amount::text, transaction_hash AS "txHash"
      FROM burn_events
      WHERE token_address = ${tokenAddress}
      ORDER BY amount::numeric DESC
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  private async getBurnTypeDistribution(
    tokenAddress: string,
    start: Date,
    end: Date
  ): Promise<BurnTypeDistribution> {
    const rows = await prisma.$queryRaw<
      { burn_type: string; volume: string; cnt: number }[]
    >`
      SELECT
        burn_type,
        COALESCE(SUM(amount::numeric), 0)::text AS volume,
        COUNT(*)::int AS cnt
      FROM burn_events
      WHERE token_address = ${tokenAddress}
        AND burned_at >= ${start}
        AND burned_at < ${end}
      GROUP BY burn_type
    `;

    const byType = (type: string) =>
      rows.find((r) => r.burn_type === type) ?? { volume: "0", cnt: 0 };

    const selfRow = byType("self");
    const adminRow = byType("admin");

    const totalVolume = BigInt(selfRow.volume) + BigInt(adminRow.volume);

    const pct = (v: bigint) =>
      totalVolume === 0n
        ? 0
        : Math.round(Number((v * 10000n) / totalVolume) / 100);

    return {
      self: selfRow.volume,
      admin: adminRow.volume,
      selfPercentage: pct(BigInt(selfRow.volume)),
      adminPercentage: pct(BigInt(adminRow.volume)),
    };
  }

  private async buildTimeSeries(
    tokenAddress: string,
    window: PeriodWindow
  ): Promise<TimeSeriesDataPoint[]> {
    const gran = window.granularity;
    // Safe: gran is constrained to known literal values
    const rows = await prisma.$queryRawUnsafe<
      { ts: string; value: string; count: number }[]
    >(
      `SELECT
         DATE_TRUNC('${gran}', burned_at)::text AS ts,
         COALESCE(SUM(amount::numeric), 0)::text AS value,
         COUNT(*)::int AS count
       FROM burn_events
       WHERE token_address = $1
         AND burned_at >= $2
         AND burned_at < $3
       GROUP BY DATE_TRUNC('${gran}', burned_at)
       ORDER BY ts ASC`,
      tokenAddress,
      window.start,
      window.end
    );

    return this.fillTimeSeriesGaps(rows, window);
  }

  private fillTimeSeriesGaps(
    rows: { ts: string; value: string; count: number }[],
    window: PeriodWindow
  ): TimeSeriesDataPoint[] {
    const map = new Map(rows.map((r) => [r.ts.slice(0, 16), r]));
    const result: TimeSeriesDataPoint[] = [];

    const cursor = new Date(window.start);
    while (cursor < window.end) {
      const key = cursor.toISOString().slice(0, 16);
      const row = map.get(key);
      result.push({
        timestamp: cursor.toISOString(),
        value: row?.value ?? "0",
        count: row?.count ?? 0,
      });
      this.advanceCursor(cursor, window.granularity);
    }

    return result;
  }

  // ──────────────────────────────────────────────
  // Bucket utilities
  // ──────────────────────────────────────────────

  /**
   * Truncate a Date to the start of its granularity bucket (UTC-aligned).
   */
  truncateToBucket(date: Date, granularity: Granularity): Date {
    const d = new Date(date);
    d.setUTCMilliseconds(0);
    d.setUTCSeconds(0);
    d.setUTCMinutes(0);

    if (granularity === "hour") {
      return d;
    }

    d.setUTCHours(0);

    if (granularity === "day") {
      return d;
    }

    // "week" — ISO-week: truncate to the Monday of the current week
    const dayOfWeek = d.getUTCDay(); // 0 = Sunday
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    d.setUTCDate(d.getUTCDate() - daysToMonday);
    return d;
  }

  // ──────────────────────────────────────────────
  // Time-window utilities
  // ──────────────────────────────────────────────

  private getPeriodWindow(period: TimePeriod): PeriodWindow {
    const now = new Date();
    switch (period) {
      case "24h":
        return {
          start: this.hoursAgo(24),
          end: now,
          granularity: "hour",
          intervalCount: 24,
        };
      case "7d":
        return {
          start: this.daysAgo(7),
          end: now,
          granularity: "day",
          intervalCount: 7,
        };
      case "30d":
        return {
          start: this.daysAgo(30),
          end: now,
          granularity: "day",
          intervalCount: 30,
        };
      case "90d":
        return {
          start: this.daysAgo(90),
          end: now,
          granularity: "week",
          intervalCount: 13,
        };
      case "all":
      default:
        return {
          start: new Date("2020-01-01"),
          end: now,
          granularity: "month",
          intervalCount: 0,
        };
    }
  }

  private getPreviousWindow(window: PeriodWindow): PeriodWindow {
    const duration = window.end.getTime() - window.start.getTime();
    return {
      start: new Date(window.start.getTime() - duration),
      end: window.start,
      granularity: window.granularity,
      intervalCount: window.intervalCount,
    };
  }

  private windowDurationDays(window: PeriodWindow): number {
    return (window.end.getTime() - window.start.getTime()) / 86_400_000;
  }

  private hoursAgo(h: number): Date {
    return new Date(Date.now() - h * 3_600_000);
  }

  private daysAgo(d: number): Date {
    return new Date(Date.now() - d * 86_400_000);
  }

  private advanceCursor(d: Date, granularity: PeriodWindow["granularity"]) {
    switch (granularity) {
      case "hour":
        d.setHours(d.getHours() + 1);
        break;
      case "day":
        d.setDate(d.getDate() + 1);
        break;
      case "week":
        d.setDate(d.getDate() + 7);
        break;
      case "month":
        d.setMonth(d.getMonth() + 1);
        break;
    }
  }

  private calcChangePercent(prev: bigint, curr: bigint): number {
    if (prev === 0n) return curr > 0n ? 100 : 0;
    const change = Number(((curr - prev) * 10000n) / prev) / 100;
    return Math.round(change * 100) / 100;
  }
}

/** Singleton instance for use across the app */
export const analyticsService = new AnalyticsService();
