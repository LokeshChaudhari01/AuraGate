-- =============================================================================
-- AuraGate — Migration: Add routing_reason to usage_logs
-- =============================================================================
-- Phase 4: Tracks WHY each request was routed to a specific model.
-- Values: under_threshold, over_threshold, complexity_based,
--         user_specified, fallback_provider, cache_hit
-- =============================================================================

ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "routing_reason" varchar(30);
