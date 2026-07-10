import { PrismaClient } from '@prisma/client';
import {
  INVOICE_TEMPLATE_LAYOUT_PRESETS,
  presetCodeForLayout,
} from '../seed-data/invoice-template-presets';

export async function seedInvoiceTemplates(prisma: PrismaClient) {
  const effectiveFrom = new Date('2026-01-01T00:00:00.000Z');

  for (const preset of INVOICE_TEMPLATE_LAYOUT_PRESETS) {
    const code = presetCodeForLayout(preset.key);
    await prisma.invoiceTemplate.upsert({
      where: { code },
      update: {
        name: preset.name,
        templateType: preset.templateType,
        version: '1.0',
        scope: preset.scope,
        deliveryMethod: preset.deliveryMethod,
        groupingRule: preset.groupingRule,
        fileNamePattern: preset.fileNamePattern,
        billingFrequency: preset.billingFrequency,
        layoutPreset: preset.key,
        includeRemittance: preset.includeRemittance,
        status: preset.status,
        effectiveFrom,
        effectiveTo: null,
        notes: `${preset.description} (${preset.usedBy})`,
        deletedAt: null,
      },
      create: {
        name: preset.name,
        code,
        templateType: preset.templateType,
        version: '1.0',
        scope: preset.scope,
        deliveryMethod: preset.deliveryMethod,
        groupingRule: preset.groupingRule,
        fileNamePattern: preset.fileNamePattern,
        billingFrequency: preset.billingFrequency,
        layoutPreset: preset.key,
        includeRemittance: preset.includeRemittance,
        status: preset.status,
        effectiveFrom,
        notes: `${preset.description} (${preset.usedBy})`,
        fields: {
          create: preset.fields.map((field, index) => ({
            label: field.label,
            systemFieldKey: field.systemFieldKey,
            isRequired: field.isRequired,
            sortOrder: index,
          })),
        },
      },
    });

    const template = await prisma.invoiceTemplate.findUnique({ where: { code } });
    if (!template) continue;

    await prisma.invoiceTemplateField.deleteMany({ where: { invoiceTemplateId: template.id } });
    if (preset.fields.length) {
      await prisma.invoiceTemplateField.createMany({
        data: preset.fields.map((field, index) => ({
          invoiceTemplateId: template.id,
          label: field.label,
          systemFieldKey: field.systemFieldKey,
          isRequired: field.isRequired,
          sortOrder: index,
        })),
      });
    }
  }
}
