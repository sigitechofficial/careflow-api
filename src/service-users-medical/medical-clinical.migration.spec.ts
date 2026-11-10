import { readFileSync } from 'fs';
import { join } from 'path';
import {
  MEDICAL_CLINICAL_PERMISSION_KEYS,
  SERVICE_USER_MONITORING_CONFIG_KEYS,
} from './medical-clinical.constants';

describe('Medical Conditions & Alerts clinical SoT foundation (Phase 2)', () => {
  const migrationPath = join(
    __dirname,
    '../../prisma/migrations/20260907160000_medical_conditions_alerts_clinical_sot/migration.sql',
  );
  const schemaPath = join(__dirname, '../../prisma/schema.prisma');

  it('migration is additive and creates clinical tables without touching alerts.Alert', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('CREATE TABLE "service_users"."MedicalConditionCatalog"');
    expect(sql).toContain('CREATE TABLE "service_users"."ServiceUserMedicalCondition"');
    expect(sql).toContain('CREATE TABLE "service_users"."ServiceUserReasonableAdjustment"');
    expect(sql).toContain('CREATE TABLE "service_users"."ServiceUserMedicalHistoryEvent"');
    expect(sql).toContain('CREATE TABLE "service_users"."ServiceUserMonitoringConfig"');
    expect(sql).toContain('CREATE TABLE "service_users"."ServiceUserUsualParameter"');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "ServiceUserMedicalCondition_serviceUserId_conditionId_key"',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "ServiceUserMonitoringConfig_serviceUserId_configKey_key"',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "ServiceUserUsualParameter_serviceUserId_observationTypeId_key"',
    );
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP SCHEMA/i);
    expect(sql).not.toContain('CREATE TABLE "alerts"."Alert"');
    expect(sql).not.toMatch(/ALTER TABLE "alerts"\."Alert"/i);
  });

  it('migrations seed every medical clinical permission without alerts.* changes', () => {
    // The medical alerts permissions came later, in their own migration.
    const sql = [
      readFileSync(migrationPath, 'utf8'),
      readFileSync(join(__dirname, '../../prisma/migrations/20261226110000_medical_alert_permissions/migration.sql'), 'utf8'),
    ].join('\n');
    for (const key of MEDICAL_CLINICAL_PERMISSION_KEYS) {
      expect(sql).toContain(`'${key}'`);
    }
    expect(sql).not.toMatch(/DROP TABLE "identity"\."Permission"/i);
  });

  it('prisma schema registers clinical models and keeps Alert free of medical fields', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    expect(schema).toContain('model MedicalConditionCatalog {');
    expect(schema).toContain('model ServiceUserMedicalCondition {');
    expect(schema).toContain('model ServiceUserReasonableAdjustment {');
    expect(schema).toContain('model ServiceUserMedicalHistoryEvent {');
    expect(schema).toContain('model ServiceUserMonitoringConfig {');
    expect(schema).toContain('model ServiceUserUsualParameter {');
    expect(schema).toContain('@@unique([serviceUserId, conditionId])');
    expect(schema).toContain('observationTypeId');
    expect(schema).not.toMatch(/model Alert \{[\s\S]*medicalCondition/i);
    expect(schema).not.toContain('model ServiceUserClinicalSection');
    expect(schema).not.toContain('model MedicalAlert');
  });

  it('monitoring config keys are constants only (no invented threshold defaults)', () => {
    expect(SERVICE_USER_MONITORING_CONFIG_KEYS.WEIGHT_CHANGE_THRESHOLD_KG).toBe(
      'WEIGHT_CHANGE_THRESHOLD_KG',
    );
    expect(SERVICE_USER_MONITORING_CONFIG_KEYS.FLUID_TARGET_REQUIRED).toBe(
      'FLUID_TARGET_REQUIRED',
    );
  });
});
