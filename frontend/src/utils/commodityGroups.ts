// Single source of truth for commodity group → member symbols.
// One mapping only — desk, Group State nav, metric strips, and filters all read
// from here. No duplicated group→symbol lists anywhere else.
//
// Symbols follow the spec's contract mapping (CL/BZ/NG/RB/HO, GC/SI/HG/PA/PL, …).
// "proxy" entries are documented where no liquid futures ticker exists.

export type CommodityGroupId =
  | "all"
  | "energy"
  | "metals"
  | "industrial"
  | "agriculture"
  | "soft"
  | "battery"
  | "fertilizers"
  | "livestock";

export interface CommodityGroupDef {
  id: CommodityGroupId;
  label: string;
  // Liquid futures / tracked symbols for the group (registry-driven membership).
  // Order is meaningful: symbols[0] is the group LEADER shown in the monitor.
  symbols: string[];
  // Reference inventory authorities (group-aware inventory monitor).
  inventorySources: string[];
  // Group-aware weather themes.
  weatherThemes: string[];
  // Group-aware supply-queue event families.
  supplyEvents: string[];
}

// Canonical display order for the Commodity Group Monitor (All first).
export const COMMODITY_GROUP_ORDER: CommodityGroupId[] = [
  "all",
  "energy",
  "metals",
  "industrial",
  "agriculture",
  "soft",
  "battery",
  "fertilizers",
  "livestock",
];

export const COMMODITY_GROUP_DEFS: Record<CommodityGroupId, CommodityGroupDef> = {
  energy: {
    id: "energy",
    label: "Energy",
    symbols: ["CL", "BZ", "NG", "RB", "HO"],
    inventorySources: ["EIA", "Crude", "Gasoline", "Distillates", "Natural Gas"],
    weatherThemes: ["Pipeline storms", "Heat", "Hurricanes", "Freeze"],
    supplyEvents: ["OPEC Meeting", "EIA Inventory", "Natural Gas Storage", "Refinery Outages"],
  },
  metals: {
    id: "metals",
    label: "Metals",
    symbols: ["GC", "SI", "HG", "PA", "PL"],
    inventorySources: ["LME", "COMEX", "Warehouse Stocks"],
    weatherThemes: ["Mine-region weather", "Power outages"],
    supplyEvents: ["LME Stocks", "COMEX Deliveries", "Smelter Outages"],
  },
  industrial: {
    id: "industrial",
    label: "Industrial",
    symbols: ["HG", "ALI", "ZN", "NI", "STEEL"],
    inventorySources: ["LME", "SHFE", "Warehouse Stocks"],
    weatherThemes: ["Mine-region weather", "Logistics"],
    supplyEvents: ["Production Data", "Trade Flows"],
  },
  agriculture: {
    id: "agriculture",
    label: "Agriculture",
    symbols: ["ZC", "ZW", "ZS", "KE", "RR", "ZM"],
    inventorySources: ["USDA", "Corn", "Soybeans", "Wheat"],
    weatherThemes: ["Rainfall", "Temperature", "Drought", "Harvest"],
    supplyEvents: ["WASDE", "Crop Progress", "Export Sales", "Harvest"],
  },
  soft: {
    id: "soft",
    label: "Soft",
    symbols: ["CC", "KC", "SB", "CT", "OJ"],
    inventorySources: ["ICE", "Exchange Stocks"],
    weatherThemes: ["Brazil", "India", "Vietnam", "Weather"],
    supplyEvents: ["Crop Progress", "Export Sales", "Weather Shocks"],
  },
  battery: {
    id: "battery",
    label: "Battery",
    // No single liquid futures complex; documented proxies + liquid members only — never fabricated.
    symbols: ["Lithium", "Uranium", "Cobalt", "Rare Earth", "Nickel"],
    inventorySources: ["Exchange Stocks", "Producer Disclosures"],
    weatherThemes: ["Mine-region weather", "Logistics"],
    supplyEvents: ["Producer Guidance", "Refinery Outages"],
  },
  fertilizers: {
    id: "fertilizers",
    label: "Fertilizers",
    symbols: ["Urea", "Potash", "Phosphate"],
    inventorySources: ["Producer Disclosures", "Exchange Stocks"],
    weatherThemes: ["Natural Gas (feedstock)", "Logistics"],
    supplyEvents: ["Producer Guidance", "Export Policy"],
  },
  livestock: {
    id: "livestock",
    label: "Livestock",
    symbols: ["LE", "HE", "GF"],
    inventorySources: ["USDA", "Cold Storage"],
    weatherThemes: ["Heat Stress", "Feed Costs"],
    supplyEvents: ["Cattle on Feed", "Cold Storage", "Export Sales"],
  },
};

export const COMMODITY_GROUP_IDS = Object.keys(COMMODITY_GROUP_DEFS) as CommodityGroupId[];

export function getGroupSymbols(group: string): string[] {
  const def = COMMODITY_GROUP_DEFS[group.toLowerCase() as CommodityGroupId];
  return def ? def.symbols : [];
}

export function getGroupDef(group: string): CommodityGroupDef | null {
  return COMMODITY_GROUP_DEFS[group.toLowerCase() as CommodityGroupId] || null;
}

// Groups that have at least one liquid, non-proxy symbol.
export function isGroupTradable(group: string): boolean {
  const def = getGroupDef(group);
  return !!def && def.symbols.some((s) => !/proxy/i.test(s));
}
