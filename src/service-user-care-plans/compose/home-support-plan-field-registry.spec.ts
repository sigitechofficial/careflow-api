import { HOME_SUPPORT_PLAN_SEED } from '../../../prisma/seeds/home-support-plan.seed-data';
import {
  HSP_AUTO_PREFILL_KEYS,
  HSP_FIELD_REGISTRY,
  HSP_MANUAL_KEYS,
  HSP_PILOT_AUTO_PREFILL_KEYS,
  HSP_PILOT_SUGGESTION_KEYS,
  HSP_SUGGESTION_KEYS,
  assertHspRegistryMatchesTemplate,
  hspFieldRegistryEntry,
  hspTierManifestFromRegistry,
} from './home-support-plan-field-registry';

describe('home-support-plan-field-registry (phase 2C)', () => {
  it('covers all 45 hsp_* template fields exactly once', () => {
    expect(() => assertHspRegistryMatchesTemplate()).not.toThrow();
    expect(HSP_FIELD_REGISTRY).toHaveLength(45);
  });

  it('assigns every field a mode and source', () => {
    for (const entry of HSP_FIELD_REGISTRY) {
      expect(entry.mode).toMatch(/^(AUTO_PREFILL|SUGGESTION|MANUAL)$/);
      expect(entry.source).toBeTruthy();
      expect(entry.sources.length).toBeGreaterThan(0);
      expect(entry.sources[0]?.kind).toBeTruthy();
    }
  });

  it('partitions fields into auto-prefill, suggestion, and manual tiers', () => {
    expect(HSP_AUTO_PREFILL_KEYS).toHaveLength(17);
    expect(HSP_SUGGESTION_KEYS).toHaveLength(23);
    expect(HSP_MANUAL_KEYS).toHaveLength(5);
    expect(HSP_AUTO_PREFILL_KEYS.length + HSP_SUGGESTION_KEYS.length + HSP_MANUAL_KEYS.length).toBe(
      45,
    );
  });

  it('marks all AUTO_PREFILL fields with implemented resolvers', () => {
    expect(HSP_PILOT_AUTO_PREFILL_KEYS).toEqual(HSP_AUTO_PREFILL_KEYS);
  });

  it('marks all SUGGESTION fields with implemented resolvers', () => {
    expect(HSP_PILOT_SUGGESTION_KEYS).toEqual(HSP_SUGGESTION_KEYS);
  });

  it('lists manual-only fields with MANUAL source', () => {
    expect(HSP_MANUAL_KEYS).toEqual([
      'hsp_planned_hours_visits',
      'hsp_finance_support_details',
      'hsp_equipment_maintenance_contact',
      'hsp_risks_if_support_not_provided',
      'hsp_progress_notes',
    ]);
    for (const key of HSP_MANUAL_KEYS) {
      const entry = hspFieldRegistryEntry(key);
      expect(entry?.mode).toBe('MANUAL');
      expect(entry?.source).toBe('MANUAL');
    }
  });

  it('builds tier manifest from registry for compose metadata', () => {
    const manifest = hspTierManifestFromRegistry();
    expect(manifest.autoPrefill).toEqual(HSP_AUTO_PREFILL_KEYS);
    expect(manifest.suggestion).toEqual(HSP_SUGGESTION_KEYS);
    expect(manifest.manual).toEqual(HSP_MANUAL_KEYS);
  });

  it('matches template field keys from seed data', () => {
    const templateKeys = HOME_SUPPORT_PLAN_SEED.sections.flatMap((s) =>
      s.fields.map((f) => f.fieldKey),
    );
    const registryKeys = HSP_FIELD_REGISTRY.map((e) => e.businessKey);
    expect(new Set(registryKeys)).toEqual(new Set(templateKeys));
  });
});
