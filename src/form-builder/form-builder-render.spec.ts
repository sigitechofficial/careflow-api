import { formInclude, mapField } from './form-builder.service';

/**
 * Regression test for the "3 duplicate Person-centred details still visible" bug.
 *
 * The UI renders a care-plan form from the field ROWS returned by `formInclude`, not from
 * the version schemaJson. The ID-safe care-plan appliers remove a field by DEACTIVATING it
 * (isActive:false) while keeping the soft row (deletedAt:null) so its UUID and any saved
 * values survive. If the renderer only filters `deletedAt: null`, those deactivated rows
 * still render — which is exactly why Skin Integrity showed 3 "Person-centred details"
 * fields after two were deactivated. The renderer must also filter `isActive: true`.
 */
describe('form-builder renderer contract (formInclude)', () => {
  it('maps conditionalLogicJson so Care Plan isFieldVisible can hide/show follow-ups', () => {
    const logic = {
      showWhen: [{ sectionId: 'sec-1', fieldId: 'area-risk', operator: 'is_true' }],
    };
    expect(
      mapField({
        id: 'identify',
        fieldKey: 'eating_and_drinking_risk_identify',
        label: 'Identify the risk?',
        fieldType: 'RICH_TEXT',
        placeholder: null,
        helpText: null,
        required: true,
        optionsJson: null,
        validationJson: null,
        conditionalLogicJson: logic,
        sortOrder: 5,
      }).conditionalLogicJson,
    ).toEqual(logic);
    expect(
      mapField({
        id: 'identify',
        fieldKey: 'eating_and_drinking_risk_identify',
        label: 'Identify the risk?',
        fieldType: 'RICH_TEXT',
        placeholder: null,
        helpText: null,
        required: true,
        optionsJson: null,
        validationJson: null,
        sortOrder: 5,
      }).conditionalLogicJson,
    ).toBeNull();
  });

  it('only returns active, non-deleted fields (so deactivated fields are never rendered)', () => {
    const fieldWhere = (formInclude as any).currentVersion.include.sections.include.fields.where;
    expect(fieldWhere).toEqual({ deletedAt: null, isActive: true });
  });

  it('only returns non-deleted sections', () => {
    const sectionWhere = (formInclude as any).currentVersion.include.sections.where;
    expect(sectionWhere).toEqual({ deletedAt: null });
  });
});
