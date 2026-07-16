// Group → macro transmission drivers (evidence-backed, not hallucinated).
// These reflect well-established cross-market transmission paths documented in the
// existing Transmission Registry vocabulary (Inflation, Rates, USD, Industrials, EM FX…).
// Each group maps to an ordered chain of macro nodes the Transmission Engine can render.
//
// Source of truth for group→symbols lives in commodityGroups.ts; this file adds the
// macro transmission layer only. No fabricated confidence — the engine derives that.

import { COMMODITY_GROUP_DEFS } from "./commodityGroups";
import type { CommodityGroupId } from "./commodityGroups";

export interface GroupTransmissionDef {
  // Ordered macro driver chain for the group (root first).
  chain: string[];
}

export const GROUP_TRANSMISSION: Record<CommodityGroupId, GroupTransmissionDef> = {
  energy: { chain: ["Energy", "Inflation", "Rates", "Utilities", "Industrials", "Airlines", "Portfolio Holdings"] },
  metals: { chain: ["Metals", "Industrial Production", "USD", "Construction", "Autos", "Portfolio Holdings"] },
  industrial: { chain: ["Industrial Metals", "Manufacturing PMI", "Global Growth", "EM Equities", "Portfolio Holdings"] },
  agriculture: { chain: ["Agriculture", "Food CPI", "Emerging FX", "Fertilizer", "Consumer Staples", "Portfolio Holdings"] },
  soft: { chain: ["Softs", "Food CPI", "Emerging FX", "Consumer Staples", "Weather Risk", "Portfolio Holdings"] },
  battery: { chain: ["Battery Metals", "EV Production", "Industrial Production", "USD", "Clean Energy", "Portfolio Holdings"] },
};

export function getGroupTransmissionChain(group: string): string[] {
  const def = GROUP_TRANSMISSION[group.toLowerCase() as CommodityGroupId];
  return def ? def.chain : [];
}

// Demand / supply driver labels per group — sourced from commodityGroups themes,
// surfaced verbatim so the Group Profile never invents drivers.
export function getGroupDrivers(group: string) {
  const def = COMMODITY_GROUP_DEFS[group.toLowerCase() as CommodityGroupId];
  if (!def) return { demand: [], supply: [], weather: [], inventory: [] };
  return {
    demand: def.symbols.filter((s) => !/proxy/i.test(s)),
    supply: def.supplyEvents,
    weather: def.weatherThemes,
    inventory: def.inventorySources,
  };
}
