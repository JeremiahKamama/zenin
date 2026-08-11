# Solana RWA Comparison Website — Research Notes

## Findings

- RWA.xyz provides an API for tokens, protocols, networks, and market metrics, with filtering, sorting, pagination, aggregation, and timeseries endpoints. Sources: https://docs.rwa.xyz/api/getting-started and https://docs.rwa.xyz/api/endpoints/assets
- RWA.xyz sources qualitative fields from issuers, pricing primarily from aggregators such as CoinGecko, and quantitative activity directly from blockchains. Source: https://docs.rwa.xyz/methodology/data-sourcing
- RWA.xyz documents asset classes including stablecoins, U.S. Treasuries, government bonds, private credit, commodities, institutional funds, stocks, and real estate. Solana is listed as fully supported. Source: https://docs.rwa.xyz/methodology/data-coverage
- RWA.xyz exposes measures such as total/NAV value, supply, daily active addresses, holding addresses, mint/burn activity, transfer volume, transaction counts, and credit-specific principal/interest/default fields. Source: https://docs.rwa.xyz/schemas/measures
- RWA.xyz asset fields include issuer, regions, sectors, transparency, custody, segregation, bankruptcy remoteness, deposit insurance, networks, protocols, deployed contracts, ratings, capacity, supply, and token flows. Source: https://docs.rwa.xyz/schemas/assets
- RWA.xyz states that pricing and on-chain data are refreshed daily and that historical records are retained when assets are delisted. Source: https://docs.rwa.xyz/methodology/data-update
- Tokens.xyz presents itself as a Solana asset-level discovery and liquidity surface, organizing products by asset, issuer, liquidity, and route. Source: https://www.tokens.xyz/
- Solana's official RWA overview identifies tokenized treasuries, public-market funds, ETFs, commodities, equities, and private credit as active categories, and names Tokens.xyz as an asset-level discovery surface. Source: https://solana.com/solutions/real-world-assets
- X/Twitter is useful for discovery, launch monitoring, and qualitative confidence signals, but posts should not be treated as canonical metrics. Examples include Solana announcements and protocol posts about tokenized equities and private credit: https://x.com/solana/status/2062871652082610213 and https://x.com/plumenetwork/status/2003161512664543537

## Product implication

Use RWA.xyz and issuer disclosures for canonical identity, classification, legal/custody/transparency metadata, and historical asset fundamentals. Use Solana RPC/indexers, DEX APIs, Tokens.xyz, and venue feeds for current liquidity, spreads, routes, volume, and wallet behavior. Use X as an event and sentiment layer with provenance and confidence labels.
