/** Words that mean the same in certificate and compliance names. */
function normaliseName(s: string): string {
  return ` ${s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/licen[cs]e/g, 'licence')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

/**
 * The compliance type a certificate counts towards, by name: the longest compliance type name that appears as
 * whole words in the certificate name ("Full UK driving licence" → "Driving Licence", "Care Certificate awarded"
 * → "Care Certificate"). Null when nothing matches, so unrelated certificates are left alone.
 */
export function matchComplianceTypeForCertificate<T extends { id: string; name: string }>(
  certificateName: string | null | undefined,
  complianceTypes: T[],
): T | null {
  if (!certificateName?.trim()) return null;
  const cert = normaliseName(certificateName);
  let best: T | null = null;
  let bestLen = 0;
  for (const t of complianceTypes) {
    const n = normaliseName(t.name);
    if (n.trim().length < 3) continue;
    if (cert.includes(n) && n.length > bestLen) {
      best = t;
      bestLen = n.length;
    }
  }
  return best;
}
