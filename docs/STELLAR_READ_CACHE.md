# Stellar Read Query Caching

## Overview

Response caching for idempotent Stellar Horizon/RPC read queries reduces RPC load and latency with configurable TTL and intelligent cache invalidation on writes.

## Architecture

### Cache Layer

```
Read Query
    ↓
StellarReadCache (in-memory)
    ↓
Cache Hit? → Return cached value
    ↓
Cache Miss → Execute query
    ↓
Cache result with TTL
    ↓
Return value
```

### Invalidation Strategy

```
Write Operation
    ↓
Execute write
    ↓
Invalidate cache entries for affected address
    ↓
Return result
```

## Configuration

### Environment Variables

```bash
# Cache TTL in milliseconds (default: 30000)
STELLAR_READ_CACHE_TTL_MS=30000

# Enable/disable caching (default: true)
STELLAR_READ_CACHE_ENABLED=true
```

### Programmatic Configuration

```typescript
import { initializeStellarCache } from './stellar-cache.decorator';

// Initialize with custom TTL (in milliseconds)
initializeStellarCache(60000); // 60 second TTL
```

## Usage

### Using Decorators

#### Cache Read Queries

```typescript
import { CacheStellarRead } from './stellar-cache.decorator';

class StellarService {
  @CacheStellarRead('tokenInfo', { ttl: 30000 })
  async getTokenInfo(tokenAddress: string): Promise<TokenInfo> {
    // Query implementation
  }

  @CacheStellarRead('account')
  async getAccount(address: string): Promise<Account> {
    // Query implementation
  }

  @CacheStellarRead('factoryState')
  async getFactoryState(): Promise<FactoryState> {
    // Query implementation
  }
}
```

#### Invalidate on Writes

```typescript
import { InvalidateStellarCache } from './stellar-cache.decorator';

class StellarService {
  @InvalidateStellarCache('tokenInfo', 0) // Invalidate by arg[0]
  async updateToken(tokenAddress: string, data: any): Promise<void> {
    // Write implementation
  }

  @InvalidateStellarCache('all') // Clear all cache
  async criticalUpdate(): Promise<void> {
    // Write implementation
  }
}
```

### Manual Cache Management

```typescript
import { getStellarCache, StellarCacheKeyBuilder } from './stellar-cache.decorator';

const cache = getStellarCache();

// Get cached value
const tokenInfo = cache.get(StellarCacheKeyBuilder.tokenInfo('GAAAA'));

// Set cache value
cache.set(StellarCacheKeyBuilder.tokenInfo('GAAAA'), tokenInfo, 30000);

// Invalidate specific entry
cache.invalidate(StellarCacheKeyBuilder.tokenInfo('GAAAA'));

// Invalidate all entries for an address
cache.invalidateByAddress('GAAAA');

// Clear all cache
cache.clear();

// Get statistics
const stats = cache.getStats();
console.log(`Cache size: ${stats.size}, Keys: ${stats.keys}`);
```

## Cache Keys

### Built-in Key Builders

```typescript
import { StellarCacheKeyBuilder } from './stellar-read-cache';

// Token information
StellarCacheKeyBuilder.tokenInfo('GAAAA')
// → 'token:GAAAA'

// Account information
StellarCacheKeyBuilder.account('GAAAA')
// → 'account:GAAAA'

// Factory state
StellarCacheKeyBuilder.factoryState()
// → 'factory:state'

// Transaction details
StellarCacheKeyBuilder.transaction('tx123')
// → 'tx:tx123'

// Contract state
StellarCacheKeyBuilder.contractState('GAAAA', 'balance')
// → 'contract:GAAAA:balance'
```

## TTL Configuration

### Default TTL

```typescript
// 30 seconds (default)
@CacheStellarRead('tokenInfo')
async getTokenInfo(address: string) { }
```

### Custom TTL per Query

```typescript
// 60 seconds
@CacheStellarRead('tokenInfo', { ttl: 60000 })
async getTokenInfo(address: string) { }

// 5 seconds (short-lived)
@CacheStellarRead('account', { ttl: 5000 })
async getAccount(address: string) { }
```

### Fresh Reads (Bypass Cache)

```typescript
// Always fetch fresh data
@CacheStellarRead('tokenInfo', { fresh: true })
async getTokenInfoFresh(address: string) { }

// Or at runtime
const cache = getStellarCache();
const result = await service.getTokenInfo(address); // Uses cache
const fresh = await service.getTokenInfoFresh(address); // Bypasses cache
```

## Invalidation Rules

### Address-Based Invalidation

When a write affects an address, all cache entries for that address are invalidated:

```typescript
@InvalidateStellarCache('tokenInfo', 0)
async updateToken(tokenAddress: string, data: any) {
  // Invalidates: token:tokenAddress
}
```

### Full Cache Invalidation

For critical operations that affect multiple addresses:

```typescript
@InvalidateStellarCache('all')
async criticalUpdate() {
  // Clears entire cache
}
```

### Manual Invalidation

```typescript
const cache = getStellarCache();

// Invalidate specific entry
cache.invalidate('token:GAAAA');

// Invalidate all entries for an address
cache.invalidateByAddress('GAAAA');

// Clear all cache
cache.clear();
```

## Performance Characteristics

### Cache Hit

- **Latency**: < 1ms (in-memory lookup)
- **RPC Calls**: 0
- **Cost**: Minimal

### Cache Miss

- **Latency**: Network latency + RPC processing
- **RPC Calls**: 1
- **Cost**: Standard RPC cost

### Typical Improvements

With 30-second TTL and 80% hit rate:

- **RPC Calls**: 80% reduction
- **Latency**: 50-70% reduction for cached queries
- **Cost**: 80% reduction in RPC costs

## Monitoring

### Cache Statistics

```typescript
const cache = getStellarCache();
const stats = cache.getStats();

console.log(`Cache entries: ${stats.size}`);
console.log(`Cached keys: ${stats.keys.join(', ')}`);
```

### Metrics to Track

- Cache hit rate
- Cache miss rate
- Average cache entry lifetime
- Memory usage
- RPC call reduction

## Best Practices

### 1. Choose Appropriate TTL

```typescript
// Short-lived data (account balance)
@CacheStellarRead('account', { ttl: 5000 })
async getAccount(address: string) { }

// Medium-lived data (token info)
@CacheStellarRead('tokenInfo', { ttl: 30000 })
async getTokenInfo(address: string) { }

// Long-lived data (factory state)
@CacheStellarRead('factoryState', { ttl: 60000 })
async getFactoryState() { }
```

### 2. Invalidate on Related Writes

```typescript
// Invalidate token cache when token is updated
@InvalidateStellarCache('tokenInfo', 0)
async updateToken(tokenAddress: string, data: any) { }

// Invalidate account cache when account is modified
@InvalidateStellarCache('account', 0)
async updateAccount(address: string, data: any) { }
```

### 3. Use Fresh Reads When Needed

```typescript
// For critical operations requiring latest data
const fresh = await service.getTokenInfoFresh(address);

// Or bypass cache explicitly
cache.invalidate(StellarCacheKeyBuilder.tokenInfo(address));
const latest = await service.getTokenInfo(address);
```

### 4. Monitor Cache Performance

```typescript
// Log cache statistics periodically
setInterval(() => {
  const stats = cache.getStats();
  logger.log(`Cache size: ${stats.size}`);
}, 60000);
```

## Testing

### Unit Tests

```typescript
import { StellarReadCache } from './stellar-read-cache';

describe('StellarReadCache', () => {
  let cache: StellarReadCache;

  beforeEach(() => {
    cache = new StellarReadCache(100); // 100ms TTL
  });

  it('should cache and retrieve values', () => {
    cache.set('key', { data: 'test' });
    expect(cache.get('key')).toEqual({ data: 'test' });
  });

  it('should expire entries after TTL', async () => {
    cache.set('key', { data: 'test' }, 50);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(cache.get('key')).toBeNull();
  });
});
```

### Integration Tests

```typescript
describe('Cache Decorators', () => {
  it('should cache read query results', async () => {
    let callCount = 0;

    class TestService {
      @CacheStellarRead('tokenInfo')
      async getTokenInfo(address: string) {
        callCount++;
        return { address, name: 'Test' };
      }
    }

    const service = new TestService();
    await service.getTokenInfo('GAAAA');
    await service.getTokenInfo('GAAAA');

    expect(callCount).toBe(1); // Called once due to cache
  });
});
```

## Troubleshooting

### Cache Not Working

1. Verify cache is initialized:
   ```typescript
   import { getStellarCache } from './stellar-cache.decorator';
   const cache = getStellarCache();
   console.log(cache.getStats());
   ```

2. Check decorator is applied:
   ```typescript
   @CacheStellarRead('tokenInfo')
   async getTokenInfo(address: string) { }
   ```

3. Verify TTL is not too short:
   ```typescript
   @CacheStellarRead('tokenInfo', { ttl: 30000 }) // 30 seconds
   ```

### Cache Not Invalidating

1. Verify invalidation decorator is applied:
   ```typescript
   @InvalidateStellarCache('tokenInfo', 0)
   async updateToken(address: string, data: any) { }
   ```

2. Check argument index is correct:
   ```typescript
   // If address is first argument (index 0)
   @InvalidateStellarCache('tokenInfo', 0)
   async updateToken(address: string, data: any) { }
   ```

3. Use manual invalidation if needed:
   ```typescript
   const cache = getStellarCache();
   cache.invalidateByAddress('GAAAA');
   ```

### High Memory Usage

1. Reduce TTL:
   ```typescript
   @CacheStellarRead('tokenInfo', { ttl: 10000 }) // 10 seconds
   ```

2. Clear cache periodically:
   ```typescript
   setInterval(() => {
     getStellarCache().clear();
   }, 300000); // Every 5 minutes
   ```

3. Monitor cache size:
   ```typescript
   const stats = getStellarCache().getStats();
   if (stats.size > 1000) {
     getStellarCache().clear();
   }
   ```

## Related Documentation

- [Stellar Service Integration](./STELLAR_SERVICE_INTEGRATION.md)
- [Rate Limiting](./RATE_LIMITING.md)
- [Performance Optimization](./PERFORMANCE.md)
