export type CarePlanPersonalisationContext = {
  /** Primary @ token — display name (legal with preferred in parentheses when set). */
  displayName: string;
  givenName: string;
  firstName: string | null;
  lastName: string | null;
  preferredName: string | null;
  legalName: string | null;
  serviceUserNumber: string | null;
};

const TOKEN_REPLACEMENTS: Array<{
  token: string;
  resolve: (ctx: CarePlanPersonalisationContext) => string;
}> = [
  { token: '@serviceUserNumber', resolve: (ctx) => ctx.serviceUserNumber ?? '' },
  { token: '@preferredName', resolve: (ctx) => ctx.preferredName ?? ctx.firstName ?? ctx.givenName },
  { token: '@legalName', resolve: (ctx) => ctx.legalName ?? ctx.displayName },
  { token: '@firstName', resolve: (ctx) => ctx.firstName ?? '' },
  { token: '@lastName', resolve: (ctx) => ctx.lastName ?? '' },
  { token: '@givenName', resolve: (ctx) => ctx.givenName },
  { token: '@', resolve: (ctx) => ctx.displayName },
];

export function buildCarePlanPersonalisationContext(params: {
  firstName?: string | null;
  lastName?: string | null;
  preferredName?: string | null;
  serviceUserNumber?: string | null;
  /** Legacy single-name preview input. */
  displayNameOverride?: string | null;
}): CarePlanPersonalisationContext {
  const firstName = params.firstName?.trim() || null;
  const lastName = params.lastName?.trim() || null;
  const preferredName = params.preferredName?.trim() || null;
  const legalName = [firstName, lastName].filter(Boolean).join(' ').trim() || null;
  const givenName = preferredName || firstName || 'this service user';
  const displayName =
    params.displayNameOverride?.trim() ||
    (legalName
      ? preferredName
        ? `${legalName} (${preferredName})`
        : legalName
      : preferredName || 'Service user');

  return {
    displayName,
    givenName,
    firstName,
    lastName,
    preferredName,
    legalName,
    serviceUserNumber: params.serviceUserNumber?.trim() || null,
  };
}

export function applyCarePlanPersonalisationTokens(
  text: string,
  ctx: CarePlanPersonalisationContext,
): string {
  let result = text;
  for (const { token, resolve } of TOKEN_REPLACEMENTS) {
    if (!result.includes(token)) continue;
    result = result.split(token).join(resolve(ctx));
  }
  return result;
}

/** Backward-compatible helper when only a single display name is available. */
export function replaceCarePlanTextPlaceholders(html: string, serviceUserName: string): string {
  const ctx = buildCarePlanPersonalisationContext({ displayNameOverride: serviceUserName });
  return applyCarePlanPersonalisationTokens(html, ctx);
}
