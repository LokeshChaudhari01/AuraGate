--[[
=============================================================================
AuraGate — Sliding Window Rate Limiter (Atomic Lua Script)
=============================================================================
Purpose:
  Implements a sliding window counter using a Redis Sorted Set (ZSET).
  The entire check-and-set operation runs atomically inside Redis — no race
  conditions even under massive concurrency from multiple Next.js workers.

Algorithm:
  1. ZREMRANGEBYSCORE: Remove all entries older than (now - window_ms).
  2. ZCARD: Count the remaining entries in the current window.
  3. If count < limit: ZADD the new request with timestamp as score.
  4. PEXPIRE: Set/refresh key TTL to window_ms for automatic cleanup.
  5. Return result array: [allowed (0|1), current_count, remaining, reset_ms]

Arguments:
  KEYS[1] = Rate limit key (e.g., "auragate:rl:<key_hash>")
  ARGV[1] = Current timestamp in milliseconds (e.g., 1719000000000)
  ARGV[2] = Window size in milliseconds (e.g., 60000 for 1 minute)
  ARGV[3] = Maximum requests allowed in the window (e.g., 100)
  ARGV[4] = Unique member identifier (e.g., "<timestamp>:<random>")

Returns:
  Array of 4 integers: [allowed, current_count, remaining, reset_ms]
  - allowed: 1 if the request is permitted, 0 if rate-limited
  - current_count: number of requests in the current window
  - remaining: how many requests are left before hitting the limit
  - reset_ms: Unix timestamp (ms) when the window resets

Interactions:
  - Called by src/lib/redis/rate-limiter.ts via ioredis defineCommand/EVALSHA.
  - The ioredis client automatically caches the script SHA after the first EVAL,
    using EVALSHA for all subsequent calls (saving ~460 bytes per request).

Performance:
  - ZREMRANGEBYSCORE: O(log(N) + M) where M = expired entries removed
  - ZCARD: O(1)
  - ZADD: O(log(N))
  - At 100 req/min per key, N ≤ 100 → total execution time < 0.1ms
=============================================================================
--]]

local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

-- Step 1: Purge all entries outside the current sliding window.
-- Entries with scores (timestamps) less than (now - window) are expired.
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)

-- Step 2: Count the remaining (active) entries in the window.
local current_count = redis.call('ZCARD', key)

-- Step 3: Decision — allow or reject the request.
if current_count < limit then
    -- Under the limit: add this request to the sorted set.
    -- Score = current timestamp, Member = unique identifier.
    redis.call('ZADD', key, now, member)

    -- Refresh the key's expiration to auto-cleanup inactive keys.
    -- This ensures keys for inactive API keys don't linger forever.
    redis.call('PEXPIRE', key, window)

    -- Update count after adding
    current_count = current_count + 1

    local remaining = limit - current_count
    local reset_ms = now + window

    -- Return: [allowed=1, current_count, remaining, reset_ms]
    return {1, current_count, remaining, reset_ms}
else
    -- Over the limit: reject the request.
    -- We still refresh PEXPIRE to keep the sorted set alive for the window.
    redis.call('PEXPIRE', key, window)

    local remaining = 0
    local reset_ms = now + window

    -- Return: [allowed=0, current_count, remaining, reset_ms]
    return {0, current_count, remaining, reset_ms}
end
