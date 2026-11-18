/**
 * Where to get the Care app, from configuration (the IDs are not known until the app is published):
 * - CARE_APP_IOS_APP_ID: the App Store app ID (digits, e.g. 1234567890);
 * - CARE_APP_ANDROID_PACKAGE: the Google Play package name (e.g. uk.co.allforcare.careapp);
 * - CARE_APP_URL_SCHEME: the app's URL scheme, to open it when it's installed (e.g. careflow).
 * Anything missing or malformed is null, and the /get-app page says it isn't set up yet.
 */
export type CareAppLinks = {
  iosAppId: string | null;
  androidPackage: string | null;
  urlScheme: string | null;
  appStoreUrl: string | null;
  playStoreUrl: string | null;
  /** Opens the app when installed: "<scheme>://". */
  openAppUrl: string | null;
  configured: boolean;
};

export function careAppLinks(env: Record<string, string | undefined> = process.env): CareAppLinks {
  const ios = (env.CARE_APP_IOS_APP_ID ?? '').trim().replace(/^id/i, '');
  const android = (env.CARE_APP_ANDROID_PACKAGE ?? '').trim();
  const scheme = (env.CARE_APP_URL_SCHEME ?? '').trim().replace(/:\/*$/, '');
  const iosAppId = /^\d{5,15}$/.test(ios) ? ios : null;
  const androidPackage = /^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$/.test(android) ? android : null;
  const urlScheme = /^[a-z][a-z0-9+.-]*$/i.test(scheme) && !/^(https?|javascript|data|file)$/i.test(scheme) ? scheme.toLowerCase() : null;
  return {
    iosAppId,
    androidPackage,
    urlScheme,
    appStoreUrl: iosAppId ? `https://apps.apple.com/gb/app/id${iosAppId}` : null,
    playStoreUrl: androidPackage ? `https://play.google.com/store/apps/details?id=${encodeURIComponent(androidPackage)}` : null,
    openAppUrl: urlScheme ? `${urlScheme}://` : null,
    configured: Boolean(iosAppId || androidPackage),
  };
}
