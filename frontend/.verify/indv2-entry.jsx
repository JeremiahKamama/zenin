import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IndicatorMetricModal } from "../src/components/IndicatorMetricModal.jsx";

const CPI = {
  code: "CPI", label: "Consumer Price Index", group: "inflation", source: "FRED", unit: "%",
  current: 143.8, previous: 142.6, consensus: 143.5, forecast: 143.4, surprise: 0.3,
  yoy: 3.2, mom: 0.4, confidence: 96,
  updatedAt: new Date(Date.now() - 2*3600*1000).toISOString(), date: "2026-06-01",
  series: Array.from({ length: 120 }, (_, i) => ({ ts: Date.now()-(120-i)*30*24*3600*1000, value: 130 + i*0.12 + Math.sin(i/6)*0.8 })),
};
const EMPTY = { code: "TEST", label: "Test Indicator", group: "activity", source: "FRED", unit: "%", current: 50 };

export function run() {
  return {
    withData: renderToStaticMarkup(React.createElement(IndicatorMetricModal, { countryName: "United States", metric: CPI, onClose(){} })),
    noData: renderToStaticMarkup(React.createElement(IndicatorMetricModal, { countryName: "United States", metric: EMPTY, onClose(){} })),
  };
}
