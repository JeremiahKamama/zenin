/**
 * Unit tests: FMP Mappers
 */

"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const mappers = require("../../providers/financial-modeling-prep/mappers");

describe("FMP Mappers", () => {
  describe("mapQuote()", () => {
    it("maps valid FMP quote to domain Quote", () => {
      const dto = {
        symbol: "AAPL",
        price: 199.50,
        change: 2.30,
        changesPercentage: 1.15,
        open: 198.00,
        high: 200.10,
        low: 197.50,
        previousClose: 197.20,
        volume: 50000000,
        avgVolume: 55000000,
        marketCap: 3000000000000,
        pe: 28.5,
        eps: 6.95,
        yearHigh: 210.00,
        yearLow: 160.00,
        timestamp: "2025-06-15 14:30:00"
      };

      const result = mappers.mapQuote(dto);
      assert.strictEqual(result.symbol, "AAPL");
      assert.strictEqual(result.price, 199.50);
      assert.strictEqual(result.change, 2.30);
      assert.strictEqual(result.changePercent, 1.15);
      assert.strictEqual(result.high52Week, 210.00);
      assert.strictEqual(result.peRatio, 28.5);
    });

    it("handles null fields gracefully", () => {
      const dto = { symbol: "EMPTY", price: null };
      const result = mappers.mapQuote(dto);
      assert.strictEqual(result.symbol, "EMPTY");
      assert.strictEqual(result.price, null);
      assert.strictEqual(result.change, null);
    });

    it("handles missing object", () => {
      const result = mappers.mapQuote(null);
      assert.strictEqual(result.symbol, "");
      assert.strictEqual(result.price, null);
    });
  });

  describe("mapCompanyProfile()", () => {
    it("maps FMP profile to domain CompanyProfile", () => {
      const dto = {
        symbol: "MSFT",
        companyName: "Microsoft Corp",
        exchange: "NASDAQ",
        currency: "USD",
        sector: "Technology",
        industry: "Software",
        description: "Microsoft develops software.",
        ceo: "Satya Nadella",
        website: "https://microsoft.com",
        image: "https://img.com/msft.png",
        country: "US",
        mktCap: 2500000000000,
        fullTimeEmployees: 221000,
        ipoDate: "1986-03-13",
        isin: "US5949181045",
        cik: "0000789019"
      };

      const result = mappers.mapCompanyProfile(dto);
      assert.strictEqual(result.symbol, "MSFT");
      assert.strictEqual(result.name, "Microsoft Corp");
      assert.strictEqual(result.sector, "Technology");
      assert.strictEqual(result.marketCap, 2500000000000);
      assert.strictEqual(result.employees, 221000);
      assert.strictEqual(result.ipoDate, "1986-03-13");
    });
  });

  describe("mapSearchResult()", () => {
    it("maps FMP search result", () => {
      const dto = {
        symbol: "AAPL",
        name: "Apple Inc.",
        stockExchange: "NASDAQ",
        currency: "USD"
      };
      const result = mappers.mapSearchResult(dto);
      assert.strictEqual(result.symbol, "AAPL");
      assert.strictEqual(result.name, "Apple Inc.");
      assert.strictEqual(result.exchange, "NASDAQ");
    });
  });

  describe("mapNewsArticle()", () => {
    it("maps FMP stock news to domain NewsArticle", () => {
      const dto = {
        symbol: "TSLA",
        publishedDate: "2025-06-15T10:00:00Z",
        title: "Tesla Q2 Delivery Numbers Beat Estimates",
        image: "https://img.com/tsla.png",
        site: "Reuters",
        text: "Tesla delivered 500,000 vehicles in Q2...",
        url: "https://reuters.com/tsla-q2"
      };
      const result = mappers.mapNewsArticle(dto, "company");
      assert.strictEqual(result.title, "Tesla Q2 Delivery Numbers Beat Estimates");
      assert.strictEqual(result.source, "Reuters");
      assert.strictEqual(result.category, "company");
      assert.deepStrictEqual(result.symbols, ["TSLA"]);
    });
  });

  describe("mapInsiderTrade()", () => {
    it("maps FMP insider trade (buy)", () => {
      const dto = {
        symbol: "AAPL",
        transactionDate: "2025-06-10",
        reportingCik: "123",
        acquisitionOrDisposition: "A",
        transactionType: "P-Purchase",
        securitiesTransacted: 10000,
        price: 195.50,
        reportingName: "Tim Cook",
        typeOfOwner: "direct",
        filingDate: "2025-06-12",
        formType: "4"
      };
      const result = mappers.mapInsiderTrade(dto);
      assert.strictEqual(result.symbol, "AAPL");
      assert.strictEqual(result.transactionType, "buy");
      assert.strictEqual(result.shares, 10000);
      assert.strictEqual(result.pricePerShare, 195.50);
      assert.strictEqual(result.insiderName, "Tim Cook");
    });

    it("maps FMP insider trade (sell)", () => {
      const dto = {
        symbol: "MSFT",
        acquisitionOrDisposition: "D",
        securitiesTransacted: 5000,
        price: 400.00,
        reportingName: "John Doe"
      };
      const result = mappers.mapInsiderTrade(dto);
      assert.strictEqual(result.transactionType, "sell");
    });
  });

  describe("mapEarningsEvent()", () => {
    it("maps FMP earnings surprise", () => {
      const dto = {
        symbol: "NVDA",
        date: "2025-05-21",
        estimatedEarning: 0.65,
        reportedEarning: 0.72,
        surprise: 0.07,
        surprisePercentage: 10.77,
        estimatedRevenue: 28000000000,
        reportedRevenue: 28500000000
      };
      const result = mappers.mapEarningsEvent(dto);
      assert.strictEqual(result.symbol, "NVDA");
      assert.strictEqual(result.actualEps, 0.72);
      assert.strictEqual(result.estimatedEps, 0.65);
      assert.strictEqual(result.surpriseEpsPercent, 10.77);
    });
  });

  describe("mapDividendRecord()", () => {
    it("maps FMP dividend", () => {
      const dto = {
        symbol: "AAPL",
        date: "2025-05-09",
        dividend: 0.25,
        paymentDate: "2025-05-16",
        declarationDate: "2025-05-01",
        recordDate: "2025-05-12"
      };
      const result = mappers.mapDividendRecord(dto);
      assert.strictEqual(result.symbol, "AAPL");
      assert.strictEqual(result.dividend, 0.25);
      assert.strictEqual(result.payableDate, "2025-05-16");
    });
  });

  describe("mapAnalystRating()", () => {
    it("detects upgrade action", () => {
      const dto = {
        symbol: "META",
        recommendation: "upgrade",
        analystCompany: "Morgan Stanley",
        analystTargetPrice: 600,
        numberOfAnalysts: 42
      };
      const result = mappers.mapAnalystRating(dto);
      assert.strictEqual(result.symbol, "META");
      assert.strictEqual(result.action, "upgrade");
      assert.strictEqual(result.firm, "Morgan Stanley");
      assert.strictEqual(result.targetPrice, 600);
    });
  });

  describe("mapMarketStatus()", () => {
    it("maps open market status", () => {
      const dto = {
        isTheStockMarketOpen: true,
        stockMarketHours: { openingHour: "09:30", closingHour: "16:00" }
      };
      const result = mappers.mapMarketStatus(dto, "US");
      assert.strictEqual(result.isOpen, true);
      assert.strictEqual(result.sessionStatus, "open");
      assert.strictEqual(result.exchange, "US");
    });
  });
});
