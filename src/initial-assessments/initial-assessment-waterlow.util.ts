/**
 * App re-export of the seed-safe Waterlow helper.
 * Implementation lives in prisma/seed-lib so `prisma db seed` can run without `src/`.
 */
export {
  type WaterlowMetadataLike,
  computeWaterlowScore,
  waterlowScoreFromMetadata,
  waterlowCarePlanRequired,
  enrichWaterlowMetadata,
} from '../../prisma/seed-lib/initial-assessment-waterlow.util';
