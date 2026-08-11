# Zenin Brokerage Abstraction Architecture

Zenin uses a **provider-agnostic brokerage abstraction layer** built around Clean Architecture and Domain-Driven Design (DDD) principles. This ensures that Zenin's core application logic never directly depends on any specific brokerage provider (e.g., SnapTrade, Alpaca, Plaid).

The application communicates exclusively with Zenin's internal **Brokerage Domain Models** and the generic `BrokerageService`.

## High-Level Architecture

```text
Zenin App (API/UI)
       │
       ▼
[ BrokerageService ] ───────► (SyncEngine)
       │                           │
       ▼                           ▼
[ BrokerageRegistry ]       [ Repository (DB) ]
       │
       ▼
« BrokerageProvider » (Interface)
       │
       ├─────────────────────────────────┐
       ▼                                 ▼
[ SnapTradeProvider ]            [ AlpacaProvider ]
       │                                 │
   SnapTrade SDK                     Alpaca SDK
```

### 1. Application Layer (`backend/brokerage/application/`)
- **BrokerageService**: The facade used by API routes. It resolves the active provider through the registry and orchestrates connections and syncs.
- **SyncEngine**: Handles data ingestion, incremental/full sync logic, rate limiting, and retry policies. It persists data to the database using generic mappers.
- **Credentials/RateLimiter/Retry**: Supporting utilities for robust provider interactions.

### 2. Domain Layer (`backend/brokerage/domain/`)
- **models.js**: Provider-independent value objects (e.g., `InvestmentAccount`, `Holding`, `Transaction`).
- **capabilities.js**: A capability matrix (`BrokerageCapabilitySet`) that allows providers to advertise features (e.g., `supportsRealtimeBalances`, `supportsOptions`).
- **BrokerageProvider.js**: The strict interface all adapters must implement.
- **errors.js**: Zenin's internal hierarchy of errors (e.g., `BrokerageAuthenticationError`). Providers must translate their specific exceptions into these classes.

### 3. Infrastructure Layer (`backend/brokerage/infrastructure/`)
- **BrokerageRegistry**: The central registry where concrete providers are injected at startup. Validates that adapters fulfill the `BrokerageProvider` contract before accepting them.
- **bootstrap.js**: Wires up the registry and selects the default provider based on `BROKERAGE_PROVIDER` env variable.

### 4. Providers Layer (`backend/brokerage/providers/`)
- **snaptrade/**: The isolated package for the SnapTrade integration. It contains the SDK client, error translators, and DTO mappers. *No SnapTrade terminology or types leak outside this folder.*

---

## Adding a New Provider

To add a new brokerage provider (e.g., Alpaca):

1. **Create the Provider Package**: 
   Create a new folder: `backend/brokerage/providers/alpaca/`.
2. **Implement the Adapter**: 
   Create a class or factory (e.g., `AlpacaProvider`) that satisfies every method in `BrokerageProvider.js`.
3. **Map the DTOs**: 
   Write mappers to translate the provider's specific JSON responses into Zenin's domain models (`InvestmentAccount`, `Holding`, `Transaction`, etc.).
4. **Translate Errors**: 
   Catch provider-specific API exceptions and throw the corresponding `BrokerageError` subclass.
5. **Register the Provider**: 
   In `backend/brokerage/infrastructure/bootstrap.js`, instantiate the new provider and call `registry.registerProvider(newProvider)`.
6. **Switch the Environment**: 
   Set `BROKERAGE_PROVIDER=alpaca` in your `.env` file to make it the default.

That's it! Because the rest of the application relies entirely on the domain models and capabilities, no UI or API endpoint changes are necessary when a new provider is added.
