/**
 * Link to the IA. `section` is the enterprise § number (e.g. 11 = skin); it is sent as `iaSection`
 * and the admin opens whichever tab currently shows that § (tab ids/order are an admin concern).
 */
export function iaRoute(serviceUserId: string, section?: number): string {
  const base = `/service-users/initial-assessment?serviceUserId=${encodeURIComponent(serviceUserId)}`;
  return section != null ? `${base}&iaSection=${section}` : base;
}

export function medRoute(serviceUserId: string): string {
  return `/service-users/${serviceUserId}/medication`;
}

export function profileRoute(serviceUserId: string): string {
  return `/service-users/${serviceUserId}/edit`;
}

export function normalizeFieldLabel(label: string): string {
  return label.trim().toLowerCase();
}
