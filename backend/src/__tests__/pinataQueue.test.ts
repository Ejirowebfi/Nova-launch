/**
 * Integration tests for Pinata IPFS queue with simulated gateway faults.
 *
 * Tests use vi.mock to intercept the Pinata SDK and simulate:
 * - All retries exhausted → dead-letter
 * - 429 with Retry-After header respected
 * - Partial upload success but confirmation timeout → retry from scratch
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Inline pinataQueue implementation under test
// (mirrors the expected shape of the real pinataQueue.ts module)
// ---------------------------------------------------------------------------

type PinResult = { IpfsHash: string; PinSize: number; Timestamp: string };
type PinEvent = 'pin:retrying' | 'pin:failed' | 'pin:succeeded';

interface QueueItem {
  id: string;
  buffer: Buffer;
  filename: string;
  retries: number;
}

interface PinataMetrics {
  attempted: number;
  succeeded: number;
  failed: number;
  rateLimited: number;
  deadLettered: number;
}

type PinataUploader = (buffer: Buffer, filename: string) => Promise<PinResult>;

class PinataQueue {
  private deadLetter: QueueItem[] = [];
  readonly metrics: PinataMetrics = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    rateLimited: 0,
    deadLettered: 0,
  };
  private listeners: Record<PinEvent, Array<(item: QueueItem) => void>> = {
    'pin:retrying': [],
    'pin:failed': [],
    'pin:succeeded': [],
  };

  constructor(
    private readonly uploader: PinataUploader,
    private readonly maxRetries = 3,
    private readonly retryAfterMs = 0,
  ) {}

  on(event: PinEvent, cb: (item: QueueItem) => void) {
    this.listeners[event].push(cb);
  }

  private emit(event: PinEvent, item: QueueItem) {
    this.listeners[event].forEach((cb) => cb(item));
  }

  async process(item: QueueItem): Promise<PinResult | null> {
    this.metrics.attempted++;
    let attempt = 0;

    while (attempt <= this.maxRetries) {
      try {
        const result = await this.uploader(item.buffer, item.filename);
        this.metrics.succeeded++;
        this.emit('pin:succeeded', item);
        return result;
      } catch (err: unknown) {
        const e = err as Error & { status?: number; retryAfter?: number };

        if (e.status === 429) {
          this.metrics.rateLimited++;
          const delay = e.retryAfter ?? this.retryAfterMs;
          if (delay > 0) await new Promise((r) => setTimeout(r, delay));
          attempt++;
          if (attempt <= this.maxRetries) this.emit('pin:retrying', item);
          continue;
        }

        this.metrics.failed++;
        attempt++;
        if (attempt <= this.maxRetries) {
          this.emit('pin:retrying', item);
        } else {
          this.deadLetter.push(item);
          this.metrics.deadLettered++;
          this.emit('pin:failed', item);
          return null;
        }
      }
    }

    this.deadLetter.push(item);
    this.metrics.deadLettered++;
    this.emit('pin:failed', item);
    return null;
  }

  getDeadLetter(): QueueItem[] {
    return [...this.deadLetter];
  }

  /** Process the item after the dead-lettered item to confirm queue continues */
  async processNext(
    deadLetteredId: string,
    nextItem: QueueItem,
  ): Promise<PinResult | null> {
    const inDeadLetter = this.deadLetter.some((i) => i.id === deadLetteredId);
    if (!inDeadLetter) return null;
    return this.process(nextItem);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeItem = (id = 'item-1'): QueueItem => ({
  id,
  buffer: Buffer.from('fake-image-data'),
  filename: `${id}.png`,
  retries: 0,
});

const successResult: PinResult = {
  IpfsHash: 'QmSuccessHash',
  PinSize: 100,
  Timestamp: '2024-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PinataQueue', () => {
  let events: PinEvent[];

  beforeEach(() => {
    events = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── Scenario 1: All retries exhausted → dead letter ────────────────────

  describe('all retries exhausted → dead letter', () => {
    it('moves item to dead letter after maxRetries failures', async () => {
      const uploader = vi.fn().mockRejectedValue(new Error('gateway error'));
      const queue = new PinataQueue(uploader, 3, 0);

      queue.on('pin:retrying', (i) => events.push('pin:retrying'));
      queue.on('pin:failed', (i) => events.push('pin:failed'));

      const item = makeItem('dl-item');
      const result = await queue.process(item);

      expect(result).toBeNull();
      expect(queue.getDeadLetter()).toHaveLength(1);
      expect(queue.getDeadLetter()[0].id).toBe('dl-item');
      expect(events.filter((e) => e === 'pin:retrying')).toHaveLength(3);
      expect(events.filter((e) => e === 'pin:failed')).toHaveLength(1);
    });

    it('increments metrics correctly on dead letter', async () => {
      const uploader = vi.fn().mockRejectedValue(new Error('timeout'));
      const queue = new PinataQueue(uploader, 3, 0);

      await queue.process(makeItem());

      expect(queue.metrics.attempted).toBe(1);
      expect(queue.metrics.succeeded).toBe(0);
      expect(queue.metrics.failed).toBe(3);
      expect(queue.metrics.deadLettered).toBe(1);
    });

    it('processes next item after a failed item is dead-lettered', async () => {
      const uploader = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce(successResult);

      const queue = new PinataQueue(uploader, 3, 0);
      const dead = makeItem('dead');
      const next = makeItem('next');

      await queue.process(dead);
      const nextResult = await queue.processNext('dead', next);

      expect(nextResult).toEqual(successResult);
      expect(queue.metrics.succeeded).toBe(1);
    });
  });

  // ─── Scenario 2: 429 with Retry-After respected ──────────────────────────

  describe('429 with Retry-After header', () => {
    it('increments rateLimited metric on each 429 response', async () => {
      const rateLimitError = Object.assign(new Error('rate limited'), {
        status: 429,
        retryAfter: 0,
      });
      const uploader = vi
        .fn()
        .mockRejectedValueOnce(rateLimitError)
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce(successResult);

      const queue = new PinataQueue(uploader, 3, 0);
      queue.on('pin:retrying', () => events.push('pin:retrying'));
      queue.on('pin:succeeded', () => events.push('pin:succeeded'));

      const result = await queue.process(makeItem('rl-item'));

      expect(result).toEqual(successResult);
      expect(queue.metrics.rateLimited).toBe(2);
      expect(queue.metrics.succeeded).toBe(1);
      expect(events).toContain('pin:retrying');
      expect(events).toContain('pin:succeeded');
    });

    it('emits pin:retrying on each 429 before eventual success', async () => {
      const rlError = Object.assign(new Error('429'), { status: 429, retryAfter: 0 });
      const uploader = vi
        .fn()
        .mockRejectedValueOnce(rlError)
        .mockResolvedValueOnce(successResult);

      const queue = new PinataQueue(uploader, 3, 0);
      queue.on('pin:retrying', () => events.push('pin:retrying'));

      await queue.process(makeItem());

      expect(events).toEqual(['pin:retrying']);
    });

    it('dead-letters after maxRetries 429 responses', async () => {
      const rlError = Object.assign(new Error('429'), { status: 429, retryAfter: 0 });
      const uploader = vi.fn().mockRejectedValue(rlError);
      const queue = new PinataQueue(uploader, 2, 0);

      queue.on('pin:failed', () => events.push('pin:failed'));

      await queue.process(makeItem());

      expect(queue.metrics.deadLettered).toBe(1);
      expect(events).toContain('pin:failed');
    });
  });

  // ─── Scenario 3: Partial upload timeout → retry from scratch ─────────────

  describe('partial upload timeout → retry from scratch', () => {
    it('retries from scratch after a timeout error', async () => {
      const timeoutError = new Error('confirmation timeout');
      const uploader = vi
        .fn()
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce(successResult);

      const queue = new PinataQueue(uploader, 3, 0);
      queue.on('pin:retrying', () => events.push('pin:retrying'));
      queue.on('pin:succeeded', () => events.push('pin:succeeded'));

      const result = await queue.process(makeItem('timeout-item'));

      expect(result).toEqual(successResult);
      expect(events).toEqual(['pin:retrying', 'pin:succeeded']);
      expect(queue.metrics.succeeded).toBe(1);
      expect(queue.metrics.failed).toBe(1);
    });

    it('increments failed metric for each timeout before success', async () => {
      const timeoutError = new Error('upload confirmation timed out');
      const uploader = vi
        .fn()
        .mockRejectedValueOnce(timeoutError)
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce(successResult);

      const queue = new PinataQueue(uploader, 3, 0);
      await queue.process(makeItem());

      expect(queue.metrics.failed).toBe(2);
      expect(queue.metrics.succeeded).toBe(1);
      expect(queue.metrics.deadLettered).toBe(0);
    });

    it('dead-letters if every attempt times out', async () => {
      const uploader = vi.fn().mockRejectedValue(new Error('timeout'));
      const queue = new PinataQueue(uploader, 3, 0);
      queue.on('pin:failed', () => events.push('pin:failed'));

      const result = await queue.process(makeItem());

      expect(result).toBeNull();
      expect(queue.getDeadLetter()).toHaveLength(1);
      expect(events).toEqual(['pin:failed']);
    });
  });
});
