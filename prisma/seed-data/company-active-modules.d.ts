export type CompanyModuleDefinition = {
    id: string;
    label: string;
    description: string;
};
export declare const COMPANY_MODULE_CATALOG: readonly CompanyModuleDefinition[];
export declare const COMPANY_ACTIVE_MODULES: string[];
export type CompanyActiveModule = (typeof COMPANY_ACTIVE_MODULES)[number];
