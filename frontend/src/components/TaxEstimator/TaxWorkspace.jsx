import React, { useEffect, useMemo, useState } from "react";
import { formatPercent } from "../../utils/format";
import { convertToUSD, convertFromUSD } from "../../utils/currencyUtils";
import {
  getTaxConfig,
  getTaxRules,
  getTaxRegions,
  getTaxSources,
  readStoredAccountantMode,
  getDefaultIncomeBreakdown,
  getDefaultAdvancedState,
  getDefaultScenarioState,
  emptyGains,
  cloneGains,
  totalGainsAmount,
  totalOrdinaryIncome,
  buildAdjustedGains,
  calcLiability,
  parseDecimalInput,
  formatMoney,
  formatSavedTimestamp,
  normalizeSavedEstimateEntries,
  getDemoGuestState,
  deriveGainsFromTrades,
  reducePositiveGainsProportionally,
  countryFlag,
} from "./lib/taxConfig";
import { buildTaxEstimatorLedger, summarizeLedgerToGains } from "../../utils/taxEstimatorLedger";

import ScenarioHeader from "./ScenarioHeader";
import ScenarioToolbar from "./ScenarioToolbar";
import JurisdictionPanel from "./JurisdictionPanel";
import TransactionLedger from "./TransactionLedger";
import DecisionInspector from "./DecisionInspector";
import ResultsWorkspace from "./ResultsWorkspace";
import OptimizationWorkspace from "./OptimizationWorkspace";
import ComplianceWorkspace from "./ComplianceWorkspace";
import AdvancedSettingsDrawer from "./AdvancedSettingsDrawer";
import AuditTrailDrawer from "./AuditTrailDrawer";
import SavedScenarioDrawer from "./SavedScenarioDrawer";

export default function TaxWorkspace({ trades = [], portfolio = [], spotPrices = {} }) {
  const searchParams = new URLSearchParams(globalThis?.location?.search || "");
  const isGuestDemo = searchParams.get("guest") === "1";
  const guestDemoState = useMemo(() => getDemoGuestState(), []);
  const taxConfig = getTaxConfig();
  const taxRules = getTaxRules();
  const taxRegions = getTaxRegions();
  const taxSources = getTaxSources();
  const taxRulesLastUpdated = String(taxConfig.lastUpdated || "");
  const defaultIncomeBreakdown = getDefaultIncomeBreakdown();
  const defaultAdvancedState = useMemo(() => getDefaultAdvancedState(), []);

  const [jurisdictions, setJurisdictions] = useState(() => (isGuestDemo ? guestDemoState.jurisdictions : ["USA"]));
  const [jurisdictionSearch, setJurisdictionSearch] = useState("");
  const [activeRegion, setActiveRegion] = useState("All");
  const [taxYear, setTaxYear] = useState("2026");
  const [gains, setGains] = useState(() => (isGuestDemo ? guestDemoState.gains : emptyGains()));
  const [hasManualGainEdit, setHasManualGainEdit] = useState(isGuestDemo);
  const [results, setResults] = useState([]);
  const [savedEstimates, setSavedEstimates] = useState([]);
  const [auditTrail, setAuditTrail] = useState([]);
  const [showSavedScenarios, setShowSavedScenarios] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [detectedCountry, setDetectedCountry] = useState("");
  const [additionalIncome, setAdditionalIncome] = useState(defaultIncomeBreakdown);
  const [scenario, setScenario] = useState(getDefaultScenarioState());
  const [comparisonScenarios, setComparisonScenarios] = useState(() => (isGuestDemo ? guestDemoState.comparisonScenarios : []));
  const [advanced, setAdvanced] = useState(() => (isGuestDemo ? guestDemoState.advanced : defaultAdvancedState));
  const [ledgerOverrides, setLedgerOverrides] = useState({});
  const [fileName, setFileName] = useState("");
  const [showImportPreview, setShowImportPreview] = useState(false);
  const [formNotice, setFormNotice] = useState("");
  const [formNoticeTone, setFormNoticeTone] = useState("warning");
  const [complianceExpanded, setComplianceExpanded] = useState(false);
  const [accountantMode, setAccountantMode] = useState(() => readStoredAccountantMode());

  const primaryJurisdiction = jurisdictions[0] || "USA";

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("zenin_tax_estimates") || "[]");
      setSavedEstimates(normalizeSavedEstimateEntries(saved));
      const trail = JSON.parse(localStorage.getItem("zenin_tax_audit_trail") || "[]");
      setAuditTrail(Array.isArray(trail) ? trail : []);
    } catch {
      setSavedEstimates([]);
      setAuditTrail([]);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const syncAccountantMode = () => setAccountantMode(readStoredAccountantMode());
    window.addEventListener("storage", syncAccountantMode);
    window.addEventListener("zenin:tax-accountant-mode", syncAccountantMode);
    return () => {
      window.removeEventListener("storage", syncAccountantMode);
      window.removeEventListener("zenin:tax-accountant-mode", syncAccountantMode);
    };
  }, []);

  useEffect(() => {
    const locale = String(globalThis?.navigator?.language || "").toLowerCase();
    if (locale.includes("us")) setDetectedCountry("USA");
    else if (locale.includes("gb")) setDetectedCountry("UK");
    else if (locale.includes("ca")) setDetectedCountry("Canada");
    else if (locale.includes("de")) setDetectedCountry("Germany");
    else if (locale.includes("fr")) setDetectedCountry("France");
    else setDetectedCountry("USA");
  }, []);

  useEffect(() => {
    if (!detectedCountry || jurisdictions.length > 0) return;
    if (taxRules[detectedCountry]) setJurisdictions([detectedCountry]);
  }, [detectedCountry, jurisdictions.length, taxRules]);

  useEffect(() => {
    if (hasManualGainEdit) return;
    if (!Array.isArray(trades) || trades.length === 0) return;
    setGains(deriveGainsFromTrades(trades, advanced.costBasisMethod));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades, hasManualGainEdit, advanced.costBasisMethod]);

  const ordinaryIncomeTotal = useMemo(() => totalOrdinaryIncome(additionalIncome), [additionalIncome]);

  const ledgerSections = useMemo(
    () =>
      buildTaxEstimatorLedger({
        trades,
        portfolio,
        spotPrices,
        gains,
        advanced,
        overrides: ledgerOverrides,
      }),
    [advanced, gains, ledgerOverrides, portfolio, spotPrices, trades]
  );

  const effectiveGains = useMemo(() => summarizeLedgerToGains(ledgerSections), [ledgerSections]);

  const filteredJurisdictions = useMemo(
    () =>
      Object.entries(taxRules).filter(([key, info]) => {
        const matchSearch =
          info.name.toLowerCase().includes(jurisdictionSearch.toLowerCase()) ||
          key.toLowerCase().includes(jurisdictionSearch.toLowerCase());
        const matchRegion = activeRegion === "All" || info.region === activeRegion;
        return matchSearch && matchRegion;
      }),
    [activeRegion, jurisdictionSearch, taxRules]
  );

  const summaryPreview = useMemo(() => {
    const { adjustedGains, grossTotal, taxableGain, netAfterCosts, totalCosts } = buildAdjustedGains(effectiveGains, advanced);
    const first = primaryJurisdiction;
    const targetCurrency = taxRules[first]?.currency || "USD";
    const inputCurrency = advanced.currency || "USD";
    const toUSDRate = inputCurrency === "USD" ? 1 : convertToUSD(1, inputCurrency, spotPrices);

    const localGains = cloneGains(adjustedGains);
    const conversionToLocal = (value) => {
      const valueUSD = value * toUSDRate;
      return convertFromUSD(valueUSD, targetCurrency, spotPrices);
    };

    ["Equities", "Crypto", "Bonds", "Special Funds", "MMFs"].forEach((bucket) => {
      Object.keys(localGains[bucket]).forEach((key) => {
        localGains[bucket][key] = conversionToLocal(localGains[bucket][key]);
      });
    });

    const localOrdinaryIncome = conversionToLocal(ordinaryIncomeTotal);
    const { liability: baseLiability } = calcLiability(first, localGains, { ordinaryIncomeTotal: localOrdinaryIncome });
    const fromLocalToUSD = targetCurrency === "USD" ? 1 : convertToUSD(1, targetCurrency, spotPrices);
    const estimatedTax = (baseLiability * fromLocalToUSD) / toUSDRate;
    const taxableBase = taxableGain + ordinaryIncomeTotal;
    const effectiveRate = taxableBase > 0 ? (estimatedTax / taxableBase) * 100 : 0;

    return {
      jurisdiction: taxRules[first]?.name || "N/A",
      currency: inputCurrency,
      grossTotal,
      netAfterCosts,
      totalCosts,
      taxableGain,
      ordinaryIncomeTotal,
      estimatedTax,
      effectiveRate,
    };
  }, [advanced, effectiveGains, primaryJurisdiction, ordinaryIncomeTotal, spotPrices, taxRules]);

  const netAfterTax = useMemo(
    () => Math.max(0, Number(summaryPreview.grossTotal || 0) - Number(summaryPreview.estimatedTax || 0)),
    [summaryPreview]
  );

  const validationState = useMemo(() => {
    const errors = [];
    const warnings = [];
    const fieldErrors = {};
    const fieldWarnings = {};
    const ledgerFieldErrors = {};

    if (!jurisdictions.length) {
      errors.push("Select at least one jurisdiction to calculate the filing view.");
    }
    if (String(advanced.realizationMode) === "unrealized") {
      warnings.push("Unrealized mode keeps the liability at zero until a sale is recorded.");
    }
    if (advanced.acquisitionDate && advanced.saleDate && new Date(advanced.saleDate) < new Date(advanced.acquisitionDate)) {
      errors.push("Sale date is earlier than acquisition date.");
      fieldErrors.acquisitionDate = "Acquisition date must be on or before the sale date.";
      fieldErrors.saleDate = "Sale date must be on or after the acquisition date.";
    }
    if (!Number.isFinite(Number(advanced.fxRate)) || Number(advanced.fxRate) <= 0) {
      errors.push("FX conversion must be greater than zero.");
      fieldErrors.fxRate = "Enter an FX rate greater than zero.";
    }
    if (Number(advanced.fees || 0) < 0) {
      errors.push("Fees cannot be negative.");
      fieldErrors.fees = "Use a zero or positive fee amount.";
    }
    ledgerSections.forEach((section) => {
      section.rows.forEach((row) => {
        if (!Number.isFinite(Number(row.fxRate)) || Number(row.fxRate) <= 0) {
          errors.push(`${row.instrument} has an invalid FX rate.`);
          ledgerFieldErrors[row.id] = { ...(ledgerFieldErrors[row.id] || {}), fxRate: "FX rate must be greater than zero." };
        }
        if (Number(row.fees || 0) < 0) {
          errors.push(`${row.instrument} has negative fees.`);
          ledgerFieldErrors[row.id] = { ...(ledgerFieldErrors[row.id] || {}), fees: "Fees must be zero or greater." };
        }
      });
    });
    if (summaryPreview.taxableGain <= 0 && totalGainsAmount(effectiveGains) > 0) {
      warnings.push("Adjustments reduce taxable gain to zero. Review carryforwards, exemptions, and costs.");
    }
    if (String(advanced.residencyStatus) === "non-resident" && Number(advanced.withholdingTax || 0) <= 0) {
      warnings.push("Non-resident filing selected. Add withholding tax where applicable.");
      fieldWarnings.withholdingTax = "Add withholding tax if the selected jurisdiction withholds non-resident gains.";
    }
    if (!advanced.notes?.trim()) {
      warnings.push("Notes are blank. Add assumptions for auditability before sharing the output.");
      fieldWarnings.notes = "Add filing assumptions, treaty treatment, or manual adjustments for auditability.";
    }
    return { errors: Array.from(new Set(errors)), warnings, fieldErrors, fieldWarnings, ledgerFieldErrors };
  }, [advanced, effectiveGains, jurisdictions.length, ledgerSections, summaryPreview.taxableGain]);

  const inputWarnings = useMemo(() => {
    const warnings = [...validationState.warnings];
    if (!jurisdictions.length) warnings.unshift("Select at least one jurisdiction to calculate the filing view.");
    if (advanced.acquisitionDate && advanced.saleDate && new Date(advanced.saleDate) < new Date(advanced.acquisitionDate)) {
      warnings.push("Sale date is earlier than acquisition date.");
    }
    if (validationState.errors.length) {
      warnings.unshift("Resolve blocking input issues before calculating.");
    }
    return Array.from(new Set(warnings));
  }, [advanced.acquisitionDate, advanced.saleDate, jurisdictions.length, validationState.errors.length, validationState.warnings]);

  const taxLossSuggestions = useMemo(() => {
    const taxableGain = Math.max(0, Number(summaryPreview.taxableGain || 0));
    const estimatedTax = Math.max(0, Number(summaryPreview.estimatedTax || 0));
    const marginalRate = taxableGain > 0 ? Math.min(0.5, estimatedTax / taxableGain) : 0;
    if (!Array.isArray(portfolio) || portfolio.length === 0) return [];

    return portfolio
      .map((holding) => {
        const symbol = String(holding?.symbol || "").trim().toUpperCase();
        const quantity = Math.max(0, Number(holding?.quantity || 0));
        const currentPrice = Number(spotPrices?.[symbol] ?? holding?.price ?? holding?.markPrice ?? holding?.currentPrice);
        const costBasis = Number(holding?.entryPrice ?? holding?.averageCost ?? holding?.avgPrice ?? holding?.costBasis);
        if (!symbol || quantity <= 0 || !Number.isFinite(currentPrice) || !Number.isFinite(costBasis)) return null;
        const unrealizedLoss = Math.max(0, (costBasis - currentPrice) * quantity);
        if (unrealizedLoss <= 1) return null;
        const offsetAmount = taxableGain > 0 ? Math.min(taxableGain, unrealizedLoss) : unrealizedLoss;
        const estimatedSaving = taxableGain > 0 ? offsetAmount * marginalRate : 0;
        return { symbol, name: holding?.name || symbol, quantity, currentPrice, costBasis, unrealizedLoss, offsetAmount, estimatedSaving };
      })
      .filter(Boolean)
      .sort((a, b) => b.estimatedSaving - a.estimatedSaving || b.unrealizedLoss - a.unrealizedLoss)
      .slice(0, 4);
  }, [portfolio, spotPrices, summaryPreview.estimatedTax, summaryPreview.taxableGain]);

  const guestScenarioBase = useMemo(() => {
    const adjusted = buildAdjustedGains(effectiveGains, advanced).adjustedGains;
    const harvestOffset = taxLossSuggestions.reduce((sum, item) => sum + Math.max(0, Number(item.offsetAmount || 0)), 0);
    return {
      adjusted,
      harvestOffset,
      aggressiveHarvestOffset: harvestOffset > 0 ? harvestOffset * 1.35 : Math.max(0, totalGainsAmount(adjusted) * 0.14),
    };
  }, [advanced, effectiveGains, taxLossSuggestions]);

  const scenarioComparison = useMemo(() => {
    const { adjustedGains } = buildAdjustedGains(effectiveGains, advanced);
    const countryA = taxRules[scenario.countryA] ? scenario.countryA : "USA";
    const countryB = taxRules[scenario.countryB] ? scenario.countryB : "";
    const shiftDays = Number(scenario.shiftDays || 0);
    const shiftedSaleDate = advanced.saleDate
      ? new Date(new Date(advanced.saleDate).getTime() + shiftDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : "";
    const shiftedGains = buildAdjustedGains(effectiveGains, { ...advanced, saleDate: shiftedSaleDate }).adjustedGains;
    const nowA = calcLiability(countryA, adjustedGains, { ordinaryIncomeTotal }).liability;
    const nowB = countryB ? calcLiability(countryB, adjustedGains, { ordinaryIncomeTotal }).liability : null;
    const shiftedA = calcLiability(countryA, shiftedGains, { ordinaryIncomeTotal }).liability;
    return { countryA, countryB, nowA, nowB, shiftedA, shiftDays };
  }, [advanced, effectiveGains, ordinaryIncomeTotal, scenario, taxRules]);

  const comparisonScenarioRows = useMemo(
    () =>
      comparisonScenarios.map((item) => {
        const shiftedSaleDate = advanced.saleDate
          ? new Date(new Date(advanced.saleDate).getTime() + Number(item.shiftDays || 0) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
          : "";
        let scenarioGains = buildAdjustedGains(effectiveGains, { ...advanced, saleDate: shiftedSaleDate }).adjustedGains;

        if (item.strategy === "harvest") {
          scenarioGains = reducePositiveGainsProportionally(guestScenarioBase.adjusted, guestScenarioBase.harvestOffset);
        } else if (item.strategy === "defer-long-term") {
          scenarioGains = cloneGains(guestScenarioBase.adjusted);
          scenarioGains.Equities.longTerm = 0;
          scenarioGains.Crypto.longTerm = 0;
        } else if (item.strategy === "realize-losses") {
          scenarioGains = reducePositiveGainsProportionally(guestScenarioBase.adjusted, guestScenarioBase.aggressiveHarvestOffset);
        }

        const liability = calcLiability(item.country, scenarioGains, { ordinaryIncomeTotal }).liability;
        return {
          ...item,
          liability,
          effectiveRate: summaryPreview.taxableGain > 0 ? (liability / (summaryPreview.taxableGain + ordinaryIncomeTotal)) * 100 : 0,
          netAfterTax: Math.max(0, summaryPreview.grossTotal - liability),
        };
      }),
    [advanced, comparisonScenarios, effectiveGains, guestScenarioBase.adjusted, guestScenarioBase.aggressiveHarvestOffset, guestScenarioBase.harvestOffset, ordinaryIncomeTotal, summaryPreview.grossTotal, summaryPreview.taxableGain]
  );

  const scenarioTableRows = useMemo(() => {
    const baseNet = Math.max(0, summaryPreview.grossTotal - scenarioComparison.nowA);
    const baseRate =
      summaryPreview.taxableGain > 0 ? (scenarioComparison.nowA / (summaryPreview.taxableGain + ordinaryIncomeTotal)) * 100 : 0;
    const rows = [
      {
        id: `scenario-${scenarioComparison.countryA}`,
        country: scenarioComparison.countryA,
        scenario: `${countryFlag(scenarioComparison.countryA)} ${taxRules[scenarioComparison.countryA]?.name || scenarioComparison.countryA}`,
        description: "Base filing jurisdiction",
        taxDue: scenarioComparison.nowA,
        effectiveRate: baseRate,
        netAfterTax: baseNet,
        delta: 0,
        deltaPercent: 0,
        notes: taxRules[scenarioComparison.countryA]?.logic || "Base case",
        updated: taxRulesLastUpdated || "Current rules",
      },
      ...(scenarioComparison.countryB
        ? [
            {
              id: `scenario-${scenarioComparison.countryB}`,
              country: scenarioComparison.countryB,
              scenario: `${countryFlag(scenarioComparison.countryB)} ${taxRules[scenarioComparison.countryB]?.name || scenarioComparison.countryB}`,
              description: "Current comparison jurisdiction",
              taxDue: Number(scenarioComparison.nowB || 0),
              effectiveRate:
                summaryPreview.taxableGain > 0 && Number.isFinite(Number(scenarioComparison.nowB))
                  ? (Number(scenarioComparison.nowB) / (summaryPreview.taxableGain + ordinaryIncomeTotal)) * 100
                  : 0,
              netAfterTax: Math.max(0, summaryPreview.grossTotal - Number(scenarioComparison.nowB || 0)),
              delta: Number(scenarioComparison.nowB || 0) - scenarioComparison.nowA,
              deltaPercent:
                scenarioComparison.nowA > 0 ? ((Number(scenarioComparison.nowB || 0) - scenarioComparison.nowA) / scenarioComparison.nowA) * 100 : 0,
              notes: taxRules[scenarioComparison.countryB]?.logic || "Comparison",
              updated: taxRulesLastUpdated || "Current rules",
            },
          ]
        : []),
      ...comparisonScenarioRows.map((item) => ({
        id: item.id,
        country: item.country,
        scenario: item.label || `${countryFlag(item.country)} ${taxRules[item.country]?.name || item.country}`,
        description: item.description || `${Number(item.shiftDays || 0)} day sale shift`,
        taxDue: item.liability,
        effectiveRate: item.effectiveRate,
        netAfterTax: item.netAfterTax,
        delta: item.liability - scenarioComparison.nowA,
        deltaPercent: scenarioComparison.nowA > 0 ? ((item.liability - scenarioComparison.nowA) / scenarioComparison.nowA) * 100 : 0,
        notes: item.notes || `Shifted sale date by ${Number(item.shiftDays || 0)} days`,
        updated: taxRulesLastUpdated || "Current rules",
        badge: item.strategy === "harvest" && item.liability < scenarioComparison.nowA ? "Model" : "",
      })),
    ];
    return rows;
  }, [comparisonScenarioRows, ordinaryIncomeTotal, scenarioComparison.countryA, scenarioComparison.countryB, scenarioComparison.nowA, scenarioComparison.nowB, summaryPreview.grossTotal, summaryPreview.taxableGain, taxRules, taxRulesLastUpdated]);

  const jurisdictionRecommendations = useMemo(() => {
    if (results.length === 0) return [];
    const primaryLiability = results.reduce((sum, row) => sum + row.liability, 0);
    if (primaryLiability <= 0) return [];
    const currentKeys = new Set(results.map((row) => row.jurisdictionKey));
    return Object.keys(taxRules)
      .filter((key) => !currentKeys.has(key))
      .map((key) => {
        const { liability } = calcLiability(key, effectiveGains, { ordinaryIncomeTotal });
        return {
          key,
          name: taxRules[key].name,
          currency: taxRules[key].currency,
          region: taxRules[key].region,
          logic: taxRules[key].logic,
          liability,
          saving: primaryLiability - liability,
        };
      })
      .filter((row) => row.saving > 0)
      .sort((a, b) => b.saving - a.saving)
      .slice(0, 5);
  }, [effectiveGains, ordinaryIncomeTotal, results, taxRules]);

  const optimizationScore = useMemo(() => {
    if (results.length === 0) return 0;
    const totalSaving =
      jurisdictionRecommendations.reduce((sum, row) => sum + Math.max(0, Number(row.saving || 0)), 0) +
      taxLossSuggestions.reduce((sum, item) => sum + Math.max(0, Number(item.estimatedSaving || 0)), 0);
    const totalLiability = results.reduce((sum, row) => sum + Number(row.liabilityUSD || 0), 0);
    if (totalLiability <= 0) return 100;
    return Math.max(0, Math.min(100, Math.round((totalSaving / totalLiability) * 100)));
  }, [jurisdictionRecommendations, results, taxLossSuggestions]);

  const confidenceScore = useMemo(() => {
    if (isGuestDemo) return 82;
    const notesScore = advanced.notes?.trim() ? 14 : 0;
    const tradeScore = Array.isArray(trades) && trades.length > 0 ? 38 : 10;
    const resultScore = results.length > 0 ? 22 : 8;
    const fxScore = Number(advanced.fxRate || 0) > 0 ? 10 : 0;
    return Math.min(96, notesScore + tradeScore + resultScore + fxScore);
  }, [advanced.fxRate, advanced.notes, isGuestDemo, results.length, trades]);

  const summaryModel = useMemo(
    () => [
      { label: accountantMode ? "Estimated filing liability (USD)" : "Estimated liability (USD)", value: formatMoney(summaryPreview.estimatedTax, advanced.currency || "USD"), tone: "negative" },
      { label: accountantMode ? "Blended effective rate" : "Effective rate", value: formatPercent(summaryPreview.effectiveRate), tone: "positive" },
      { label: accountantMode ? "Taxable gain ledger" : "Taxable gain", value: formatMoney(summaryPreview.taxableGain, advanced.currency || "USD"), tone: "warning" },
      { label: accountantMode ? "Client net after tax" : "Net after tax", value: formatMoney(netAfterTax, advanced.currency || "USD"), tone: "positive" },
    ],
    [accountantMode, advanced.currency, netAfterTax, summaryPreview.effectiveRate, summaryPreview.estimatedTax, summaryPreview.taxableGain]
  );

  const hasBlockingIssues = validationState.errors.length > 0;
  const reviewStateLabel = hasBlockingIssues
    ? `${validationState.errors.length} blocking issue${validationState.errors.length === 1 ? "" : "s"}`
    : inputWarnings.length
    ? `${inputWarnings.length} review item${inputWarnings.length === 1 ? "" : "s"}`
    : "Ready to calculate";
  const reviewStateCopy = hasBlockingIssues
    ? accountantMode
      ? "Open Scenario Settings and correct the highlighted fields before exporting or sharing the review pack."
      : "Open Scenario Settings and correct the highlighted fields before calculating."
    : inputWarnings.length
    ? accountantMode
      ? "Inputs are reviewable, but add the missing filing context before handing this off to an accountant."
      : "Inputs are usable, but add the missing context before sharing or exporting."
    : accountantMode
    ? "Inputs are consistent and the accountant-facing review pack is ready."
    : "Inputs are consistent and the current filing view is ready for calculation.";

  const accountantCopy = useMemo(
    () => ({
      eyebrow: accountantMode ? "Accountant Review" : "Tax desk",
      title: accountantMode ? "Accountant Review Workbench" : "Tax Scenario Desk",
      subtitle: accountantMode
        ? "Audit-ready ledger, filing assumptions, and jurisdiction outputs prepared for review and handoff."
        : "Capital gains, filing assumptions, and after-tax outcomes in one compact workbench.",
      syncLabel: accountantMode ? "Review mode" : "Sync State",
      exportLabel: accountantMode ? "Export review CSV" : "Export",
      saveLabel: accountantMode ? "Save review pack" : "Save Scenario",
      jurisdictionTitle: accountantMode ? "Filing Jurisdictions" : "Jurisdiction Ledger",
      ledgerTitle: accountantMode ? "Forensic Capital Gains Ledger" : "Capital Gains Input Ledger",
      ledgerSubtitle: accountantMode ? "Audit-ready amounts in USD" : "All amounts in USD",
      resultsTitle: accountantMode ? "Jurisdiction Output Pack" : "Calculated Liabilities",
      resultsSubtitle: accountantMode
        ? `${results.length ? `${results.length} review output${results.length === 1 ? "" : "s"}` : "Run a calculation to prepare the accountant review outputs."}`
        : `${results.length ? `${results.length} jurisdiction output${results.length === 1 ? "" : "s"}` : "Run a calculation to populate jurisdiction outputs."}`,
      footerTitle: accountantMode ? "Source register & filing notes" : "Compliance & sources",
    }),
    [accountantMode, results.length]
  );

  /* ----------------------------- handlers ----------------------------- */

  const handleToggleJurisdiction = (key) => {
    setJurisdictions((current) => (current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]));
    setFormNotice("");
  };

  const handlePrimaryJurisdictionChange = (key) => {
    setJurisdictions((current) => [key, ...current.filter((entry) => entry !== key)]);
    setFormNotice("");
  };

  const handleLedgerOverride = (rowId, field, value) => {
    const parsed = parseDecimalInput(value, 0);
    setHasManualGainEdit(true);
    setLedgerOverrides((current) => ({ ...current, [rowId]: { ...current[rowId], [field]: parsed } }));
  };

  const handleAdvancedChange = (field, value) => setAdvanced((current) => ({ ...current, [field]: value }));
  const handleIncomeChange = (field, value) =>
    setAdditionalIncome((current) => ({ ...current, [field]: parseDecimalInput(value, current[field]) }));

  const handleScenarioChange = (field, value) => setScenario((current) => ({ ...current, [field]: value }));

  const handleResetLedger = () => {
    setHasManualGainEdit(false);
    setLedgerOverrides({});
    setGains(emptyGains());
    setFormNotice("Ledger reset to live trade feed.");
    setFormNoticeTone("success");
  };

  const handleCalculate = (event) => {
    event.preventDefault();
    if (validationState.errors.length) {
      setShowAdvanced(true);
      setComplianceExpanded(true);
      setFormNotice(`Resolve ${validationState.errors.length} blocking issue${validationState.errors.length === 1 ? "" : "s"} before calculating.`);
      setFormNoticeTone("warning");
      return;
    }

    const { adjustedGains, grossTotal, taxableGain, netAfterCosts, totalCosts } = buildAdjustedGains(effectiveGains, advanced);
    const newResults = jurisdictions.map((jurisdictionKey) => {
      const targetCurrency = taxRules[jurisdictionKey]?.currency || advanced.currency || "USD";
      const inputCurrency = advanced.currency || "USD";
      const toUSDRate = inputCurrency === "USD" ? 1 : convertToUSD(1, inputCurrency, spotPrices);
      const localGains = cloneGains(adjustedGains);
      const convertToLocal = (value) => convertFromUSD(value * toUSDRate, targetCurrency, spotPrices);
      ["Equities", "Crypto", "Bonds", "Special Funds", "MMFs"].forEach((bucket) => {
        Object.keys(localGains[bucket]).forEach((key) => {
          localGains[bucket][key] = convertToLocal(localGains[bucket][key]);
        });
      });
      const localOrdinaryIncome = convertToLocal(ordinaryIncomeTotal);
      const localTaxableGain = convertToLocal(taxableGain);
      const localGrossGain = convertToLocal(grossTotal);
      const localNetGain = convertToLocal(netAfterCosts);
      const localCosts = convertToLocal(totalCosts);
      const { liability: baseLiability, details } = calcLiability(jurisdictionKey, localGains, { ordinaryIncomeTotal: localOrdinaryIncome });
      const taxCredits = Math.max(0, Number(advanced.foreignTaxPaid || 0)) + Math.max(0, Number(advanced.withholdingTax || 0));
      const localTaxCredits = convertToLocal(taxCredits);
      const liability = Math.max(0, baseLiability - localTaxCredits);
      const taxableBase = localTaxableGain + localOrdinaryIncome;
      const effectiveRate = taxableBase > 0 ? (liability / taxableBase) * 100 : 0;
      const liabilityUSD = convertToUSD(liability, targetCurrency, spotPrices);
      return {
        jurisdictionKey,
        jurisdiction: taxRules[jurisdictionKey]?.name || jurisdictionKey,
        currency: targetCurrency,
        liability,
        liabilityUSD,
        grossGain: localGrossGain,
        netGain: localNetGain,
        taxableGain: localTaxableGain,
        ordinaryIncomeTotal: localOrdinaryIncome,
        effectiveRate,
        totalCosts: localCosts,
        taxCredits: localTaxCredits,
        details,
        timestamp: new Date().toISOString(),
      };
    });

    setResults(newResults);
    setFormNotice("");
    setFormNoticeTone("success");
    const totalLiability = newResults.reduce((sum, row) => sum + (Number(row.liability) || 0), 0);
    const trailEntry = {
      id: `${Date.now()}`,
      eventType: "calculation_run",
      createdAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      taxYear,
      jurisdictions,
      scenarios: [scenarioComparison.countryA, scenarioComparison.countryB].filter(Boolean).length,
      estimatedTax: totalLiability,
    };
    const nextTrail = [trailEntry, ...auditTrail].slice(0, 20);
    setAuditTrail(nextTrail);
    localStorage.setItem("zenin_tax_audit_trail", JSON.stringify(nextTrail));
  };

  const handleSave = () => {
    if (!results.length) {
      setFormNotice("Run a calculation before saving a scenario.");
      setFormNoticeTone("warning");
      return;
    }
    const entry = {
      id: `tax-scenario-${Date.now()}`,
      savedAt: new Date().toISOString(),
      label: `${taxYear || "Tax year"} · ${jurisdictions.join(", ")}`,
      jurisdictions: [...jurisdictions],
      taxYear,
      advanced: { ...advanced },
      gains: cloneGains(effectiveGains),
      additionalIncome: { ...additionalIncome },
      ledgerOverrides: { ...ledgerOverrides },
      results: results.map((row) => ({ ...row })),
    };
    const nextSaved = [entry, ...savedEstimates].slice(0, 30);
    setSavedEstimates(nextSaved);
    localStorage.setItem("zenin_tax_estimates", JSON.stringify(nextSaved));
    setFormNotice("Scenario saved.");
    setFormNoticeTone("success");
  };

  const handleExportCsv = () => {
    if (!results.length) return;
    let csv = "data:text/csv;charset=utf-8,";
    if (accountantMode) {
      csv += `Mode:,Accountant review\n`;
      csv += `Tax year:,${taxYear}\n`;
      csv += `Jurisdictions:,${jurisdictions.join(" | ")}\n`;
      csv += `Prepared at:,${new Date().toISOString()}\n`;
      csv += `Rules freshness:,${taxRulesLastUpdated || "Current release"}\n`;
      csv += `Source:,${taxSources.map((source) => source.label).join(" | ") || "Runtime config"}\n`;
      csv += `Notes:,${String(advanced.notes || "").replace(/\n/g, " ")}\n\n`;
    }
    results.forEach((row) => {
      csv += `Jurisdiction:,${row.jurisdiction}\nCurrency:,${row.currency}\nTotal Liability:,${row.liability}\nTaxable Gain:,${row.taxableGain}\nOrdinary Income:,${row.ordinaryIncomeTotal || 0}\nEffective Rate:,${row.effectiveRate}\n\n`;
      Object.entries(row.details).forEach(([key, value]) => {
        csv += `"${key}",${value}\n`;
      });
      csv += "\n---\n\n";
    });
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csv));
    link.setAttribute("download", `${accountantMode ? "accountant_review" : "tax_estimate"}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setFormNotice(accountantMode ? "Accountant review CSV exported." : "Scenario export generated.");
    setFormNoticeTone("success");
  };

  const handleDocumentImport = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setShowImportPreview(true);
    setFormNotice("Import preview attached. Map the file manually before calculation.");
    setFormNoticeTone("success");
  };

  const handleAddScenario = () => {
    const usedCountries = new Set([scenario.countryA, ...(scenario.countryB ? [scenario.countryB] : []), ...comparisonScenarios.map((item) => item.country)]);
    const nextCountry = Object.keys(taxRules).find((key) => !usedCountries.has(key)) || "Singapore";
    setComparisonScenarios((current) => [
      ...current,
      { id: `${Date.now()}-${current.length}`, country: nextCountry, shiftDays: Number(scenario.shiftDays || 0) + (current.length + 1) * 30 },
    ]);
  };

  const handleLoadSavedScenario = (entry) => {
    if (!entry || typeof entry !== "object") return;
    if (Array.isArray(entry.jurisdictions) && entry.jurisdictions.length) setJurisdictions(entry.jurisdictions);
    if (entry.taxYear) setTaxYear(entry.taxYear);
    if (entry.gains) {
      setGains(cloneGains(entry.gains));
      setHasManualGainEdit(true);
    }
    if (entry.advanced) setAdvanced((current) => ({ ...current, ...entry.advanced }));
    if (entry.additionalIncome) setAdditionalIncome({ ...defaultIncomeBreakdown, ...entry.additionalIncome });
    if (entry.ledgerOverrides) setLedgerOverrides(entry.ledgerOverrides);
    if (Array.isArray(entry.results)) setResults(entry.results);
    setShowSavedScenarios(false);
    setFormNotice(`Loaded ${entry.label || "saved scenario"}.`);
    setFormNoticeTone("success");
  };

  const handleDeleteSavedScenario = (id) => {
    const nextSaved = savedEstimates.filter((entry) => entry.id !== id);
    setSavedEstimates(nextSaved);
    localStorage.setItem("zenin_tax_estimates", JSON.stringify(nextSaved));
  };

  const handleApplyRecommendation = (key) => {
    setJurisdictions((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  return (
    <div className="perps-calculator-module tax-workbench tax-workbench-workspace-root">
      <form id="tax-workbench-form" className="tax-workbench-shell tax-workbench-workspace" onSubmit={handleCalculate}>
        {formNotice ? (
          <div
            id="tax-workbench-form-status"
            className={`tax-workbench-banner ${formNoticeTone}`.trim()}
            role={formNoticeTone === "warning" ? "alert" : "status"}
            aria-live={formNoticeTone === "warning" ? "assertive" : "polite"}
          >
            {formNotice}
          </div>
        ) : null}

        <ScenarioHeader
          accountantCopy={accountantCopy}
          savedEstimates={savedEstimates}
          onLoadSaved={handleLoadSavedScenario}
          onExport={handleExportCsv}
          onSave={handleSave}
        />

        {accountantMode ? (
          <div className="tax-workbench-accountant-banner">
            <span>
              Audit posture enabled. Ledger, filing assumptions, and jurisdiction outputs are captured for review and handoff.
            </span>
            <span className="tax-workbench-accountant-banner-meta">
              <strong>{formatSavedTimestamp(new Date().toISOString())}</strong>
              <em>{auditTrail.length} audit event{auditTrail.length === 1 ? "" : "s"}</em>
            </span>
          </div>
        ) : null}

        <ScenarioToolbar
          jurisdictions={jurisdictions}
          primaryJurisdiction={primaryJurisdiction}
          advanced={advanced}
          taxYear={taxYear}
          scenario={scenario}
          hasBlockingIssues={hasBlockingIssues}
          onPrimaryJurisdictionChange={handlePrimaryJurisdictionChange}
          onAdvancedChange={handleAdvancedChange}
          onTaxYearChange={setTaxYear}
          onScenarioChange={handleScenarioChange}
          onRun={handleCalculate}
        />

        <div className="tax-workbench-drawer-actions">
          <button type="button" className="tax-workbench-link-btn" onClick={() => setShowAdvanced(true)}>
            Scenario Settings
          </button>
          <button type="button" className="tax-workbench-link-btn" onClick={() => setShowSavedScenarios(true)}>
            Saved Scenarios
          </button>
          <button type="button" className="tax-workbench-link-btn" onClick={() => setShowAudit(true)}>
            Audit Trail
          </button>
        </div>

        <div className="tax-workbench-primary-grid">
          <JurisdictionPanel
            taxRules={taxRules}
            filteredJurisdictions={filteredJurisdictions}
            jurisdictions={jurisdictions}
            activeRegion={activeRegion}
            taxRegions={taxRegions}
            jurisdictionSearch={jurisdictionSearch}
            detectedCountry={detectedCountry}
            accountantCopy={accountantCopy}
            onToggleJurisdiction={handleToggleJurisdiction}
            onRegionChange={setActiveRegion}
            onSearchChange={setJurisdictionSearch}
          />

          <TransactionLedger
            accountantCopy={accountantCopy}
            ledgerSections={ledgerSections}
            advanced={advanced}
            validationState={validationState}
            hasManualGainEdit={hasManualGainEdit}
            onLedgerOverride={handleLedgerOverride}
            onResetLedger={handleResetLedger}
          />

          <DecisionInspector
            accountantMode={accountantMode}
            summaryPreview={summaryPreview}
            netAfterTax={netAfterTax}
            confidenceScore={confidenceScore}
            validationState={validationState}
            reviewStateLabel={reviewStateLabel}
            reviewStateCopy={reviewStateCopy}
            inputWarnings={inputWarnings}
            optimizationScore={optimizationScore}
            summaryModel={summaryModel}
            advanced={advanced}
            taxRules={taxRules}
            primaryJurisdiction={primaryJurisdiction}
            hasBlockingIssues={hasBlockingIssues}
            onRun={handleCalculate}
            onSave={handleSave}
            onExport={handleExportCsv}
          />
        </div>

        <ResultsWorkspace
          results={results}
          accountantCopy={accountantCopy}
          currency={advanced.currency || "USD"}
          assumptions={{
            taxYear,
            costBasisMethod: advanced.costBasisMethod,
            realizationMode: advanced.realizationMode,
            residencyStatus: advanced.residencyStatus,
            currency: advanced.currency || "USD",
            notes: advanced.notes,
          }}
          sources={taxSources}
          rulesLastUpdated={taxRulesLastUpdated}
        />

        <section className="tax-workbench-panel tax-workbench-scenarios">
          <DensePanelHeaderInline title="Scenario Comparison" subtitle="" actions={
            <button type="button" className="journal-btn secondary" onClick={handleAddScenario}>
              + Add scenario
            </button>
          } />
          <div className="tax-workbench-scenario-table" role="table" aria-label="Scenario comparison table">
            <div className="tax-workbench-scenario-head" role="rowgroup">
              <div role="row">
                <span role="columnheader">Scenario</span>
                <span role="columnheader">Description</span>
                <span role="columnheader">Tax due</span>
                <span role="columnheader">Effective rate</span>
                <span role="columnheader">Net after tax</span>
                <span role="columnheader">Delta vs base</span>
                <span role="columnheader">Delta %</span>
                <span role="columnheader">Key notes</span>
                <span role="columnheader">Updated</span>
              </div>
            </div>
            <div className="tax-workbench-scenario-body" role="rowgroup">
              {scenarioTableRows.map((row, index) => (
                <div className={`tax-workbench-scenario-row ${index === 0 ? "base" : ""}`.trim()} role="row" key={row.id}>
                  <div className="tax-workbench-cell tax-workbench-scenario-cell" data-label="Scenario" role="cell">
                    <strong>{row.scenario}</strong>
                    {row.badge ? <em className="tax-workbench-row-badge">{row.badge}</em> : null}
                  </div>
                  <span className="tax-workbench-cell tax-workbench-scenario-cell" data-label="Description" role="cell">{row.description}</span>
                  <strong className="tax-workbench-cell tax-workbench-scenario-cell" data-label="Tax due" role="cell">{formatMoney(row.taxDue, advanced.currency || "USD")}</strong>
                  <span className="tax-workbench-cell tax-workbench-scenario-cell" data-label="Effective rate" role="cell">{formatPercent(row.effectiveRate)}</span>
                  <span className="tax-workbench-cell tax-workbench-scenario-cell" data-label="Net after tax" role="cell">{formatMoney(row.netAfterTax, advanced.currency || "USD")}</span>
                  <span className={`tax-workbench-cell tax-workbench-scenario-cell ${row.delta <= 0 ? "positive" : "negative"}`.trim()} data-label="Delta vs base" role="cell">
                    {row.delta === 0 ? "—" : formatMoney(row.delta, advanced.currency || "USD")}
                  </span>
                  <span className={`tax-workbench-cell tax-workbench-scenario-cell ${row.deltaPercent <= 0 ? "positive" : "negative"}`.trim()} data-label="Delta %" role="cell">
                    {row.delta === 0 ? "—" : formatPercent(row.deltaPercent)}
                  </span>
                  <span className="tax-workbench-cell tax-workbench-scenario-cell" data-label="Key notes" role="cell">{row.notes}</span>
                  <span className="tax-workbench-cell tax-workbench-scenario-cell" data-label="Updated" role="cell">{row.updated}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <ComplianceWorkspace
          jurisdictions={jurisdictions}
          ledgerRows={ledgerSections.flatMap((section) => section.rows || [])}
          scenarioRows={scenarioTableRows}
          currency={advanced.currency || "USD"}
          summary={summaryPreview}
          hasBlockingIssues={hasBlockingIssues}
          expanded={complianceExpanded}
          onToggle={() => setComplianceExpanded((v) => !v)}
        />

        <OptimizationWorkspace
          jurisdictionRecommendations={jurisdictionRecommendations}
          taxLossSuggestions={taxLossSuggestions}
          jurisdictions={jurisdictions}
          currency={advanced.currency || "USD"}
          onApplyRecommendation={handleApplyRecommendation}
        />

        <details className="tax-workbench-panel tax-workbench-footer">
          <summary>{accountantCopy.footerTitle}</summary>
          <div className="tax-workbench-footer-body">
            <p>
              This estimator is informational only and does not replace tax advice. Validate rates, treaty treatment, entity structure, and filing rules with a qualified advisor.
            </p>
            <div className="tax-workbench-source-links">
              {taxSources.length ? (
                taxSources.map((source) => (
                  <a key={source.href} href={source.href} target="_blank" rel="noreferrer">
                    {source.label}
                  </a>
                ))
              ) : (
                <span>No external sources linked in runtime config.</span>
              )}
            </div>
          </div>
        </details>

        <AdvancedSettingsDrawer
          open={showAdvanced}
          onClose={() => setShowAdvanced(false)}
          advanced={advanced}
          additionalIncome={additionalIncome}
          validationState={validationState}
          onChange={handleAdvancedChange}
          onIncomeChange={handleIncomeChange}
          onDocumentImport={handleDocumentImport}
          fileName={fileName}
          showImportPreview={showImportPreview}
        />
        <AuditTrailDrawer open={showAudit} onClose={() => setShowAudit(false)} auditTrail={auditTrail} />
        <SavedScenarioDrawer open={showSavedScenarios} onClose={() => setShowSavedScenarios(false)} savedEstimates={savedEstimates} onLoad={handleLoadSavedScenario} onDelete={handleDeleteSavedScenario} />
      </form>
    </div>
  );
}

// Lightweight inline panel header so the orchestrator doesn't need a new import.
function DensePanelHeaderInline({ title, subtitle, actions }) {
  return (
    <div className="dense-panel-header">
      <div className="dense-panel-header-copy">
        <h3>{title}</h3>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="dense-panel-header-actions">{actions}</div> : null}
    </div>
  );
}
