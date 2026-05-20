/** Licensed product modules selectable on company profile. */
export type CompanyModuleDefinition = {
  id: string;
  label: string;
  description: string;
};

export const COMPANY_MODULE_CATALOG: readonly CompanyModuleDefinition[] = [
  {
    id: 'core',
    label: 'Core Modules',
    description: 'Employees, service users, scheduling, and organisation lookups.',
  },
  {
    id: 'dom-care',
    label: 'Dom Care',
    description: 'Domiciliary care visits, rotas, and domiciliary scheduling workflows.',
  },
  {
    id: 'finance',
    label: 'Finance',
    description: 'Service user funding, billing references, and financial reporting.',
  },
  {
    id: 'mapping',
    label: 'Mapping',
    description: 'Geographic areas, travel, and map-based scheduling views.',
  },
  {
    id: 'medication',
    label: 'Medication',
    description: 'MAR charts, medication profiles, administration, and reviews.',
  },
  {
    id: 'care-form-builder',
    label: 'Care Form Builder',
    description: 'Custom assessment and care forms for your organisation.',
  },
] as const;

export const COMPANY_ACTIVE_MODULES = COMPANY_MODULE_CATALOG.map((m) => m.label);

export type CompanyActiveModule = (typeof COMPANY_ACTIVE_MODULES)[number];
