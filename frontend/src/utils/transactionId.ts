/**
 * Transaction ID — issue #1154
 *
 * Generates a single logical transaction ID per page load (or explicit flow
 * boundary) and makes it available to all API clients so every outbound
 * request carries a consistent `X-Transaction-Id` header.
 *
 * The ID is stored in `sessionStorage` so it persists through soft navigations
 * and React re-renders but resets on a new tab / window.
 *
 * Header name: `X-Transaction-Id`
 * Format: `txn_<timestamp>_<random-hex>`
 */

const STORAGE_KEY = 'nova_txn_id';
const TXN_ID_HEADER = 'X-Transaction-Id' as const;

/**
 * Generate a new transaction ID.
 * Format: `txn_<unix-ms>_<8-char hex>`
 */
export function generateTransactionId(): string {
  const ts  = Date.now().toString(36);
  const rnd = Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, '0');
  return `txn_${ts}_${rnd}`;
}

/**
 * Return the current page-level transaction ID, creating one if it does not
 * exist yet.
 *
 * Safe to call in SSR/non-browser environments — falls back to an in-memory
 * value when `sessionStorage` is unavailable.
 */
let _fallback: string | undefined;

export function getTransactionId(): string {
  try {
    let id = sessionStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = generateTransactionId();
      sessionStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    // sessionStorage unavailable (SSR, private browsing restriction, etc.)
    if (!_fallback) {
      _fallback = generateTransactionId();
    }
    return _fallback;
  }
}

/**
 * Rotate the transaction ID — call this when starting a new logical flow
 * (e.g., the user initiates a new deployment or campaign).
 *
 * Returns the newly generated ID.
 */
export function rotateTransactionId(): string {
  const id = generateTransactionId();
  try {
    sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    _fallback = id;
  }
  return id;
}

/**
 * The canonical header name used to carry the transaction ID.
 * Import this constant instead of hard-coding the string.
 */
export { TXN_ID_HEADER };

/**
 * Return a headers object containing the transaction ID header.
 * Merge this into any `fetch` / `Headers` object.
 *
 * @example
 *   const res = await fetch(url, { headers: { ...transactionIdHeaders() } });
 */
export function transactionIdHeaders(): Record<string, string> {
  return { [TXN_ID_HEADER]: getTransactionId() };
}
