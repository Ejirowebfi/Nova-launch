/**
 * Health check types and interfaces
 */

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export type ServiceStatus = "up" | "down" | "degraded";

export interface ServiceHealth {
  status: ServiceStatus;
  responseTime?: number;
  message?: string;
  error?: string;
}

export interface HealthCheckResult {
  status: HealthStatus;
  timestamp: string;
  uptime: number;
  version: string;
  services: {
    database: ServiceHealth;
    stellarHorizon: ServiceHealth;
    stellarSoroban: ServiceHealth;
    ipfs: ServiceHealth;
    cache: ServiceHealth;
  };
}

export interface DetailedHealthCheckResult extends HealthCheckResult {
  metrics: {
    memory: {
      used: number;
      total: number;
      percentage: number;
    };
    cpu: {
      usage: number;
    };
    database: {
      poolSize?: number;
      activeConnections?: number;
      idleConnections?: number;
    };
    requests: {
      total: number;
      errorRate: number;
    };
  };
  /**
   * Per-service circuit breaker state (Pinata, SendGrid, Twilio, Horizon,
   * ...), keyed by service name. Populated from the shared registry in
   * `lib/circuitBreaker.ts` — services register themselves on construction,
   * so an empty object here means no outbound client has been initialized
   * yet (e.g. cold start before the first call to that service).
   */
  circuitBreakers: Record<
    string,
    {
      state: "closed" | "open" | "half-open";
      failureCount: number;
      successCount: number;
      lastFailureTime: number;
      timeSinceLastFailure: number;
    }
  >;
}

export interface HealthCheckOptions {
  timeout?: number;
  includeMetrics?: boolean;
}
