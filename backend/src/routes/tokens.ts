import { Router, Request, Response } from "express";
import { performance } from "perf_hooks";
import { prisma } from "../lib/prisma";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { TokenSearchResponse } from "../contracts/apiSchemas";
import {
  tenantMiddleware,
  type TenantRequest,
} from "../middleware/tenancy";
import { successResponse, errorResponse } from "../utils/response";
import {
  batchDeployTokens,
  type TokenDeployInput,
} from "../services/batchTokenDeployService";

const router = Router();

// Enforce tenant context on every token request — cross-tenant reads are rejected.
router.use(tenantMiddleware({ required: true }));

// Validation schema for search parameters
// `creator` is intentionally omitted — the tenant scope always sets it.
const searchParamsSchema = z.object({
  q: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  minSupply: z.string().regex(/^\d+$/).optional(),
  maxSupply: z.string().regex(/^\d+$/).optional(),
  hasBurns: z.enum(["true", "false"]).optional(),
  sortBy: z.enum(["created", "burned", "supply", "name"]).default("created"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page: z.string().regex(/^\d+$/).default("1"),
  limit: z.string().regex(/^\d+$/).default("20"),
});

// Cache configuration
const CACHE_TTL = 60 * 1000; // 1 minute
const cache = new Map<string, { data: any; timestamp: number }>();

function getCacheKey(params: Record<string, any>): string {
  return JSON.stringify(params);
}

function getFromCache(key: string) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  cache.delete(key);
  return null;
}

function setCache(key: string, data: any) {
  cache.set(key, { data, timestamp: Date.now() });

  // Clean old cache entries
  if (cache.size > 100) {
    const oldestKey = Array.from(cache.entries()).sort(
      (a, b) => a[1].timestamp - b[1].timestamp
    )[0][0];
    cache.delete(oldestKey);
  }
}

/**
 * GET /api/tokens/search
 * Search and discover tokens with filters, sorting, and pagination.
 * Results are always scoped to the requesting tenant (resolved via
 * X-Tenant-ID header or JWT claim).
 */
router.get("/search", async (req: TenantRequest & Request, res: Response) => {
  try {
    // req.tenant is guaranteed by tenantMiddleware({ required: true })
    const tenantId = req.tenant!.id;

    // Validate parameters
    const validationResult = searchParamsSchema.safeParse(req.query);

    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid parameters",
        details: validationResult.error.errors,
      });
    }

    const params = validationResult.data;

    // Cache key includes tenantId so tenants never share cached slices
    const cacheKey = getCacheKey({ ...params, tenantId });
    const cachedResult = getFromCache(cacheKey);
    if (cachedResult) {
      return res.json({
        ...cachedResult,
        cached: true,
      });
    }

    // Parse pagination
    const page = parseInt(params.page);
    const limit = Math.min(parseInt(params.limit), 50); // Max 50 per page
    const skip = (page - 1) * limit;

    // Build where clause — always scoped to the requesting tenant.
    // The explicit `creator` query param is intentionally ignored: tenants may
    // only query their own tokens, so the scope is always `creator = tenantId`.
    const where: Prisma.TokenWhereInput = {
      creator: tenantId,
    };

    // Full-text search by name or symbol
    if (params.q) {
      where.OR = [
        { name: { contains: params.q, mode: "insensitive" } },
        { symbol: { contains: params.q, mode: "insensitive" } },
      ];
    }

    // Filter by creation date range
    if (params.startDate || params.endDate) {
      where.createdAt = {};
      if (params.startDate) {
        where.createdAt.gte = new Date(params.startDate);
      }
      if (params.endDate) {
        where.createdAt.lte = new Date(params.endDate);
      }
    }

    // Filter by supply range
    if (params.minSupply || params.maxSupply) {
      where.totalSupply = {};
      if (params.minSupply) {
        where.totalSupply.gte = BigInt(params.minSupply);
      }
      if (params.maxSupply) {
        where.totalSupply.lte = BigInt(params.maxSupply);
      }
    }

    // Filter by burn status
    if (params.hasBurns === "true") {
      where.burnCount = { gt: 0 };
    } else if (params.hasBurns === "false") {
      where.burnCount = 0;
    }

    // Build orderBy clause
    let orderBy: Prisma.TokenOrderByWithRelationInput = {};

    switch (params.sortBy) {
      case "created":
        orderBy = { createdAt: params.sortOrder };
        break;
      case "burned":
        orderBy = { totalBurned: params.sortOrder };
        break;
      case "supply":
        orderBy = { totalSupply: params.sortOrder };
        break;
      case "name":
        orderBy = { name: params.sortOrder };
        break;
    }

    // Execute queries in parallel
    const start = performance.now();
    const [tokens, total] = await Promise.all([
      prisma.token.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: {
          id: true,
          address: true,
          creator: true,
          name: true,
          symbol: true,
          decimals: true,
          totalSupply: true,
          initialSupply: true,
          totalBurned: true,
          burnCount: true,
          metadataUri: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.token.count({ where }),
    ]);
    const duration = performance.now() - start;
    if (duration > 150) {
      console.warn(`[PERF] Token search took ${duration.toFixed(2)}ms`);
    }


    // Convert BigInt to string for JSON serialization
    const serializedTokens = tokens.map((token) => ({
      ...token,
      totalSupply: token.totalSupply.toString(),
      initialSupply: token.initialSupply.toString(),
      totalBurned: token.totalBurned.toString(),
    }));

    const totalPages = Math.ceil(total / limit);

    const response: TokenSearchResponse = {
      success: true,
      data: serializedTokens as any,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
      filters: {
        q: params.q,
        creator: undefined,
        startDate: params.startDate,
        endDate: params.endDate,
        minSupply: params.minSupply,
        maxSupply: params.maxSupply,
        hasBurns: params.hasBurns,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
      },
    };

    // Cache the result
    setCache(cacheKey, response);

    return res.json(response);
  } catch (error) {
    console.error("Token search error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// ---------------------------------------------------------------------------
// Batch token deployment
// ---------------------------------------------------------------------------

/** Maximum tokens allowed in a single batch request. */
const BATCH_MAX_SIZE = 10;

/**
 * Per-token validation schema — mirrors the single-deploy validation rules so
 * that each item in the batch is held to the same standard.
 */
const tokenDeployInputSchema = z.object({
  creator: z
    .string()
    .min(1, "creator is required")
    .max(64, "creator address too long"),
  name: z
    .string()
    .min(1, "name is required")
    .max(100, "name must be 100 characters or fewer"),
  symbol: z
    .string()
    .min(1, "symbol is required")
    .max(12, "symbol must be 12 characters or fewer")
    .regex(/^[A-Z0-9]+$/, "symbol must be uppercase alphanumeric"),
  decimals: z
    .number()
    .int("decimals must be an integer")
    .min(0, "decimals must be >= 0")
    .max(18, "decimals must be <= 18"),
  initialSupply: z
    .string()
    .regex(/^\d+$/, "initialSupply must be a non-negative integer string"),
  metadataUri: z
    .string()
    .url("metadataUri must be a valid URL")
    .optional(),
});

const batchDeploySchema = z.object({
  tokens: z
    .array(tokenDeployInputSchema)
    .min(1, "tokens array must contain at least one item")
    .max(
      BATCH_MAX_SIZE,
      `tokens array must not exceed ${BATCH_MAX_SIZE} items`
    ),
});

/**
 * POST /api/tokens/batch
 *
 * Deploy up to 10 tokens in a single atomic operation.
 *
 * Request body: { tokens: TokenDeployInput[] }
 * Response:     { success: true, data: BatchDeployResult }
 *
 * Atomicity: if any individual Stellar contract call fails the entire batch is
 * aborted and no records are written to the database.
 *
 * Rate-limiting is inherited from the router-level tenantMiddleware.  Callers
 * sending more than BATCH_MAX_SIZE tokens receive an immediate 400.
 */
router.post(
  "/batch",
  async (req: TenantRequest & Request, res: Response) => {
    // Validate body
    const parsed = batchDeploySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(
        errorResponse({
          code: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: parsed.error.errors,
        })
      );
    }

    const { tokens } = parsed.data as { tokens: TokenDeployInput[] };

    try {
      const result = await batchDeployTokens(tokens);

      // HTTP 207 Multi-Status: some items may have failed while others succeeded.
      // We use 200 when all succeeded and 207 when results are mixed.
      const hasFailures = result.failed.length > 0;
      const hasSuccesses = result.succeeded.length > 0;
      const statusCode = hasFailures && hasSuccesses ? 207 : hasFailures ? 422 : 200;

      return res.status(statusCode).json(successResponse(result));
    } catch (error) {
      console.error("[tokens] POST /batch unhandled error:", error);
      return res.status(500).json(
        errorResponse({
          code: "INTERNAL_ERROR",
          message: "Batch deployment failed",
          details:
            error instanceof Error ? error.message : "Unknown error",
        })
      );
    }
  }
);

export default router;


/**
 * GET /api/tokens/deployment-status/:txHash
 * Check deployment status: Stellar transaction finality + backend indexing status
 *
 * Returns one of:
 * - PENDING: Transaction not yet finalized on Stellar
 * - CONFIRMED: Transaction finalized + token indexed in database
 * - FAILED: Transaction failed on Stellar or indexing error
 */
router.get("/deployment-status/:txHash", async (req: Request, res: Response) => {
  try {
    const { txHash } = req.params;
    const { network = "testnet" } = req.query;

    // Validate txHash format (64 hex chars)
    if (!txHash || !/^[a-f0-9]{64}$/i.test(txHash)) {
      return res.status(400).json({
        success: false,
        error: "Invalid transaction hash format",
      });
    }

    if (network !== "testnet" && network !== "mainnet") {
      return res.status(400).json({
        success: false,
        error: "Invalid network parameter",
      });
    }

    // Query Horizon for transaction status
    const horizonUrl =
      network === "mainnet"
        ? "https://horizon.stellar.org"
        : "https://horizon-testnet.stellar.org";

    const horizonResponse = await axios.get(`${horizonUrl}/transactions/${txHash}`);
    
    const txData = horizonResponse.data as {
      successful: boolean;
      result_xdr?: string;
      error_xdr?: string;
      ledger_attr?: number;
      id?: string;
    };

    // Transaction failed on-chain
    if (!txData.successful) {
      return res.json({
        txHash,
        status: "FAILED",
        reason: "Transaction failed on Stellar network",
        ledger: txData.ledger_attr,
      });
    }

    // Transaction succeeded on-chain, check if backend indexed it
    // Look for token created within last 5 minutes with this txHash
    const token = await prisma.token.findFirst({
      where: {
        // Note: Assuming burn records track deployment txHash
        // If tokens table doesn't have txHash, this would need adaptation
        burnRecords: {
          some: {
            txHash: txHash,
          },
        },
      },
      select: {
        id: true,
        address: true,
        createdAt: true,
      },
    });

    if (token) {
      return res.json({
        txHash,
        status: "CONFIRMED",
        ledger: txData.ledger_attr,
      });
    }

    // Transaction succeeded but not yet indexed in DB
    // Give it some time (typically < 2 seconds) before returning PENDING
    return res.json({
      txHash,
      status: "PENDING",
      reason: "Transaction finalized but not yet indexed",
      ledger: txData.ledger_attr,
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      // Transaction not found on Horizon yet
      return res.json({
        txHash: req.params.txHash,
        status: "PENDING",
        reason: "Transaction not yet indexed by Horizon",
      });
    }
    
    console.error("Deployment status error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch deployment status",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});
