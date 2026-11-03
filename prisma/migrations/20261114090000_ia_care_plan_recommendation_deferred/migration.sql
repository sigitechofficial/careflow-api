-- Additive only: Defer decision for persisted IA care plan recommendations.
ALTER TYPE "service_users"."InitialAssessmentCarePlanRecommendationStatus" ADD VALUE IF NOT EXISTS 'DEFERRED';
