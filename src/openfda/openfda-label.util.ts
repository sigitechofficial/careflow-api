/** Escape user input for openFDA Lucene search queries. */
export function escapeOpenFdaSearchTerm(term: string): string {
  return term
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/[+\-&|!(){}[\]^"~*?:/]/g, '\\$&');
}

export function buildOpenFdaDrugLabelSearchQuery(term: string): string {
  const escaped = escapeOpenFdaSearchTerm(term);
  if (!escaped) return '';
  const wild = `${escaped}*`;
  return [
    `openfda.brand_name:${wild}`,
    `openfda.generic_name:${wild}`,
    `openfda.substance_name:${wild}`,
  ].join(' OR ');
}

function firstString(values: unknown): string | undefined {
  if (!Array.isArray(values) || values.length === 0) return undefined;
  const v = values[0];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function joinStrings(values: unknown, maxLen: number): string | undefined {
  if (!Array.isArray(values)) return undefined;
  const text = values
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return undefined;
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}

export type OpenFdaRawLabel = {
  openfda?: {
    brand_name?: string[];
    generic_name?: string[];
    substance_name?: string[];
    route?: string[];
    product_type?: string[];
    pharm_class_epc?: string[];
    pharm_class_moa?: string[];
  };
  purpose?: string[];
  indications_and_usage?: string[];
  active_ingredient?: string[];
  dosage_and_administration?: string[];
  spl_product_data_elements?: string[];
};

export type OpenFdaDrugLabelHit = {
  id: string;
  displayName: string;
  brandName?: string;
  genericName?: string;
  substanceNames: string[];
  routes: string[];
  dosageFormHint?: string;
  purpose?: string;
  indications?: string;
  activeIngredient?: string;
  doseHint?: string;
  isControlledHint: boolean;
  productType?: string;
};

function extractDoseHint(activeIngredient?: string, splElements?: string): string | undefined {
  const sources = [activeIngredient, splElements].filter(Boolean) as string[];
  for (const src of sources) {
    const match = src.match(/\b(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|iu|units?)\b/i);
    if (match) return `${match[1]} ${match[2].toLowerCase()}`;
  }
  return undefined;
}

function inferDosageFormHint(label: OpenFdaRawLabel, displayName: string): string | undefined {
  const blob = [
    displayName,
    ...(label.openfda?.brand_name ?? []),
    ...(label.spl_product_data_elements ?? []),
    joinStrings(label.active_ingredient, 400),
  ]
    .join(' ')
    .toLowerCase();

  if (/\bpatch\b/.test(blob)) return 'PATCH';
  if (/\b(cream|ointment|lotion|gel)\b/.test(blob)) {
    if (/\bcream\b/.test(blob)) return 'CREAM';
    if (/\bointment\b/.test(blob)) return 'OINTMENT';
    if (/\blotion\b/.test(blob)) return 'LOTION';
    return 'CREAM';
  }
  if (/\b(inhaler|inhalation|aerosol)\b/.test(blob)) return 'INHALER';
  if (/\b(injection|injectable|prefilled syringe)\b/.test(blob)) return 'INJECTION';
  if (/\b(capsule|caplet)\b/.test(blob)) return 'CAPSULE';
  if (/\b(tablet|tab\b|chewable)\b/.test(blob)) return 'TABLET';
  if (/\b(drops|solution|suspension|syrup|liquid)\b/.test(blob)) return 'LIQUID';
  if (/\bspray\b/.test(blob)) return 'SPRAY';
  if (/\bsachet\b/.test(blob)) return 'SACHET';
  return undefined;
}

function controlledHint(label: OpenFdaRawLabel): boolean {
  const parts = [
    ...(label.openfda?.pharm_class_epc ?? []),
    ...(label.openfda?.pharm_class_moa ?? []),
    ...(label.openfda?.product_type ?? []),
    joinStrings(label.indications_and_usage, 800) ?? '',
    joinStrings(label.spl_product_data_elements, 400) ?? '',
  ].join(' ');
  return /controlled substance|schedule\s*(ii|iii|iv|v)\b|c-ii\b|ciii\b/i.test(parts);
}

export function mapOpenFdaLabelResult(
  raw: OpenFdaRawLabel & { id?: string; set_id?: string },
  index: number,
): OpenFdaDrugLabelHit | null {
  const brand = firstString(raw.openfda?.brand_name);
  const generic = firstString(raw.openfda?.generic_name);
  const displayName = brand ?? generic;
  if (!displayName) return null;

  const substanceNames = (raw.openfda?.substance_name ?? []).filter(
    (s): s is string => typeof s === 'string' && s.trim().length > 0,
  );
  const routes = (raw.openfda?.route ?? []).filter(
    (r): r is string => typeof r === 'string' && r.trim().length > 0,
  );
  const activeIngredient = joinStrings(raw.active_ingredient, 280);
  const splBlob = joinStrings(raw.spl_product_data_elements, 400);

  return {
    id: raw.id ?? raw.set_id ?? `row-${index}`,
    displayName,
    brandName: brand,
    genericName: generic,
    substanceNames,
    routes,
    dosageFormHint: inferDosageFormHint(raw, displayName),
    purpose: firstString(raw.purpose),
    indications: joinStrings(raw.indications_and_usage, 420),
    activeIngredient,
    doseHint: extractDoseHint(activeIngredient, splBlob),
    isControlledHint: controlledHint(raw),
    productType: firstString(raw.openfda?.product_type),
  };
}

export function dedupeOpenFdaHits(hits: OpenFdaDrugLabelHit[]): OpenFdaDrugLabelHit[] {
  const seen = new Set<string>();
  const out: OpenFdaDrugLabelHit[] = [];
  for (const hit of hits) {
    const key = `${hit.displayName.toLowerCase()}|${(hit.genericName ?? '').toLowerCase()}|${hit.dosageFormHint ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}
