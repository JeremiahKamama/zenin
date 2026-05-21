const { z } = require("zod");

const emailSchema = z.string().email().max(255).toLowerCase().trim();
const passwordSchema = z.string()
  .min(10, "Password must be at least 10 characters long")
  .regex(/[a-z]/i, "Password must contain at least one letter")
  .regex(/\d/, "Password must contain at least one number")
  .regex(/[^a-z0-9]/i, "Password must contain at least one special character");

const symbolSchema = z.string().min(1).max(30).toUpperCase().trim();
const nameSchema = z.string().min(1).max(255).trim();

const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().max(100).trim().optional(),
});

const signinSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});

const forgotPasswordRequestSchema = z.object({
  email: emailSchema,
});

const forgotPasswordConfirmSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

const tradeExecutionInputSchema = z.object({
  symbol: symbolSchema,
  name: nameSchema,
  price: z.number().finite(),
  quantity: z.number().finite(),
  type: z.enum(["stock", "crypto", "bond", "commodity", "etf", "options"]),
  marketType: z.string().max(50).toLowerCase().trim().optional(),
  orderType: z.enum(["buy", "sell"]),
  buyCurrency: z.string().max(10).toUpperCase().trim().optional(),
  currency: z.string().max(10).toUpperCase().trim().optional(),
  notionalInBuyCurrency: z.number().finite().nonnegative().optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  executedAt: z.string().datetime().optional(),
  date_added: z.string().datetime().optional(),
  clientId: z.string().min(1).max(120),
  strategyName: z.string().max(100).optional().nullable(),
  legsJson: z.union([z.array(z.any()), z.record(z.any())]).optional().nullable(),
});

const executeTradeSchema = tradeExecutionInputSchema;

const tradeEstimateInputSchema = tradeExecutionInputSchema.omit({
  clientId: true,
});

const tradeEstimateBatchSchema = z.object({
  trades: z.array(tradeEstimateInputSchema).min(1).max(50),
});

const portfolioUpdateSchema = z.object({
  price: z.number().finite().nonnegative(),
  quantity: z.number().finite(),
});

const watchlistAssetSchema = z.object({
  symbol: symbolSchema,
  name: nameSchema,
  type: z.string().max(50).toLowerCase().trim(),
  marketType: z.string().max(50).toLowerCase().trim().optional().nullable(),
  category: z.string().max(100).toLowerCase().trim().optional().nullable(),
  theme: z.string().max(100).trim().optional().nullable(),
  date_added: z.string().datetime().optional().nullable(),
});

const workspaceDocSchema = z.object({
  document: z.any().optional().nullable(),
  payloadJson: z.any().optional().nullable(),
}).refine(
  (value) => Object.prototype.hasOwnProperty.call(value, "document") || Object.prototype.hasOwnProperty.call(value, "payloadJson"),
  { message: "document is required" }
).transform((value) => ({
  document: value.document ?? value.payloadJson ?? null
}));

const workspaceCollectionSchema = z.object({
  items: z.array(z.any()).optional(),
  itemsJson: z.array(z.any()).optional(),
  limit: z.number().int().positive().optional()
}).refine(
  (value) => Array.isArray(value.items) || Array.isArray(value.itemsJson),
  { message: "items is required" }
).transform((value) => ({
  items: Array.isArray(value.items) ? value.items : value.itemsJson,
  limit: value.limit
}));

const optionsCalculationSchema = z.object({
  symbol: symbolSchema,
  legs: z.array(z.any()).max(30),
  breakevens: z.array(z.any()).max(30),
});

const historyQuerySchema = z.object({
  symbol: symbolSchema,
  interval: z.enum(["1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d", "5d", "1wk", "1mo", "3mo"]).optional().default("1d"),
  range: z.enum(["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"]).optional().default("1mo"),
  marketType: z.enum(["spot", "perp", "equity", "options"]).optional().default("equity"),
});

const pricesQuerySchema = z.object({
  symbols: z.string().optional(),
  symbol: z.string().optional(),
  type: z.enum(["tradfi", "crypto"]).optional(),
  quoteType: z.enum(["tradfi", "crypto"]).optional().default("tradfi"),
});

const searchQuerySchema = z.object({
  q: z.string().min(1).max(100),
  type: z.enum(["tradfi", "crypto", "indicator", "indicators", "commodity", "commodities"]).optional().default("tradfi"),
});

const emailRequestSchema = z.object({
  newEmail: emailSchema,
  currentPassword: z.string().min(1),
});

const emailConfirmSchema = z.object({
  verificationCode: z.string().length(6),
});

const passwordUpdateSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

const planUpdateSchema = z.object({
  plan: z.enum(["starter", "pro", "desk"]),
  billingCycle: z.enum(["monthly", "yearly"]),
});

const workspaceUpdateSchema = z.object({
  name: z.string().min(2).max(120).trim().optional(),
  slug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/i, "Slug may only contain letters, numbers, and hyphens").trim().optional(),
}).refine(
  (value) => Object.prototype.hasOwnProperty.call(value, "name") || Object.prototype.hasOwnProperty.call(value, "slug"),
  { message: "At least one workspace field is required." }
);

const workspaceInviteSchema = z.object({
  email: emailSchema,
  role: z.enum(["admin", "member"]).default("member"),
});

const workspaceMemberRoleSchema = z.object({
  role: z.enum(["admin", "member"]),
});

const workspaceAlertAssignmentSchema = z.object({
  alertKey: z.string().min(1).max(120).trim(),
  assignedToUserId: z.number().int().positive().optional().nullable(),
  status: z.enum(["open", "assigned", "snoozed", "archived"]).optional().default("open"),
  snoozedUntil: z.string().datetime().optional().nullable(),
  notes: z.record(z.any()).optional().nullable(),
});

const watchlistBulkSchema = z.object({
  assets: z.array(watchlistAssetSchema),
});

const tradeLogSchema = z.object({
  clientId: z.string().min(1).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  executedAt: z.string().datetime(),
  asset: symbolSchema,
  name: nameSchema,
  type: z.string().max(50),
  side: z.enum(["buy", "sell"]),
  marketType: z.string().max(50).optional().default("spot"),
  status: z.string().max(50),
  quantity: z.number().finite(),
  price: z.number().finite(),
  notional: z.number().finite(),
  platform: z.string().max(50).toLowerCase().trim().optional(),
  fee: z.number().finite().nonnegative().optional().nullable(),
  feeCurrency: z.string().max(10).toUpperCase().trim().optional().nullable(),
  feeSource: z.string().max(50).toLowerCase().trim().optional().nullable(),
  slippage: z.number().finite().nonnegative().optional().nullable(),
  referencePrice: z.number().finite().nonnegative().optional().nullable(),
  executionMeta: z.record(z.any()).optional().nullable(),
  balanceAfter: z.number().finite().optional().nullable(),
  portfolioValueAfter: z.number().finite().optional().nullable(),
  accountEquityAfter: z.number().finite().optional().nullable(),
  positionAfter: z.number().finite().optional().nullable(),
  strategyName: z.string().max(100).optional().nullable(),
  legsJson: z.union([z.array(z.any()), z.record(z.any())]).optional().nullable(),
});

const balanceChangeSchema = z.object({
  amount: z.number().finite().positive(),
  type: z.enum(["deposit", "withdraw"]),
});

const cashChangeSchema = z.object({
  amount: z.number().finite().positive(),
  type: z.enum(["deposit", "withdraw"]),
  currency: z.string().max(10).toUpperCase().optional().default("USD"),
});

const twoFactorEnableSchema = z.object({
  method: z.enum(["authenticator", "sms", "email"]),
  verificationCode: z.string().length(6),
  provider: z.string().max(50).optional().nullable(),
  target: z.string().max(255).optional().nullable(),
});

const passkeyRegisterSchema = z.object({
  name: z.string().min(2).max(100),
  provider: z.string().max(100).optional().default("Platform Authenticator"),
});

const cryptoOptionsSchema = z.object({
  currency: z.string().max(10).toUpperCase().optional().default("BTC"),
  expiry: z.union([z.string(), z.number()]).optional().nullable(),
});

const equityOptionsQuerySchema = z.object({
  underlying: z.string().min(1).max(15).toUpperCase().trim().optional().default("SPY"),
  expiry: z.string().max(20).trim().optional().nullable(),
  limit: z.coerce.number().int().positive().max(500).optional().default(160),
});

const supportedExchangeIds = [
  "binance",
  "bybit",
  "kraken",
  "okx",
  "coinbase_advanced",
  "hyperliquid",
  "dydx",
  "aevo",
  "lyra",
  "derive",
  "interactive_brokers",
  "alpaca",
  "tradier",
  "schwab",
  "robinhood",
  "polymarket",
  "kalshi"
];

const normalizeExchangeId = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/&/g, "and")
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");

const exchangeKeySchema = z.object({
  exchange: z.preprocess(normalizeExchangeId, z.enum(supportedExchangeIds)),
  apiKey: z.string().min(1).max(255),
  apiSecret: z.string().max(255).optional().nullable(),
  extraData: z.record(z.any()).optional().nullable(),
  permissionScope: z.enum(["unknown", "read_only", "trade"]).optional().default("unknown"),
  canTrade: z.boolean().optional().default(false),
  lastVerifiedScope: z.enum(["unknown", "read_only", "trade"]).optional().default("unknown"),
  riskLevel: z.enum(["standard", "sensitive", "trading"]).optional().default("standard"),
});

const validate = (schema, source = "body") => (req, res, next) => {
  try {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const errors = result.error.errors.map(err => ({
        path: err.path.join("."),
        message: err.message
      }));
      return res.status(400).json({
        error: "Validation failed",
        message: "One or more inputs are invalid.",
        code: "VALIDATION_ERROR",
        details: errors,
        retryable: false
      });
    }
    req[source] = result.data;
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  validate,
  signupSchema,
  signinSchema,
  forgotPasswordRequestSchema,
  forgotPasswordConfirmSchema,
  executeTradeSchema,
  tradeEstimateBatchSchema,
  portfolioUpdateSchema,
  watchlistAssetSchema,
  workspaceDocSchema,
  workspaceCollectionSchema,
  optionsCalculationSchema,
  historyQuerySchema,
  pricesQuerySchema,
  searchQuerySchema,
  emailRequestSchema,
  emailConfirmSchema,
  passwordUpdateSchema,
  planUpdateSchema,
  workspaceUpdateSchema,
  workspaceInviteSchema,
  workspaceMemberRoleSchema,
  workspaceAlertAssignmentSchema,
  watchlistBulkSchema,
  tradeLogSchema,
  balanceChangeSchema,
  cashChangeSchema,
  twoFactorEnableSchema,
  passkeyRegisterSchema,
  cryptoOptionsSchema,
  equityOptionsQuerySchema,
  exchangeKeySchema,
};
