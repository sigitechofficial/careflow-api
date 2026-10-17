/**
 * App re-export of the explicit-grant permission list.
 * Implementation lives in prisma/seed-lib so `prisma db seed` can run without `src/`.
 */
export { EXPLICIT_GRANT_PERMISSIONS, requiresExplicitGrant } from '../../../prisma/seed-lib/explicit-grant-permissions';
