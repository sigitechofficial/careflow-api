export function iaRoute(serviceUserId: string, section?: number): string {
  const base = `/service-users/initial-assessment?serviceUserId=${encodeURIComponent(serviceUserId)}`;
  return section != null ? `${base}&section=${section}` : base;
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
