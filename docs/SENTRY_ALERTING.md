# Sentry Alerting Playbook — Zenin

Sentry alerts are configured in the Sentry UI (not in code). This document provides copy-paste alert definitions to recreate the recommended alerting setup. Configuring these requires access to the Sentry org — it cannot be automated from the repository.

## How to create an alert

Sentry → your project → Alerts → Create Alert. Choose the "Custom Rule" type for fine-grained control. Each definition below maps to one rule.

---

## Critical alerts (page someone)

### 1. Crash-free sessions drop

**Trigger:** Crash-free session rate falls below 99.5% over 1 hour.

```
When: session.crash_free_rate() < 99.5%
Over: 1h window
Per: release
Then: send to on-call channel (Slack/email)
```

**Why:** The headline reliability metric. A drop means users are actively hitting crashes.

### 2. Error spike (backend)

**Trigger:** New issue with >10 events in 5 minutes on the `zenin-backend` project.

```
When: event.level:error count > 10
Over: 5m window
Filter: tags[component] == backend
Then: send to on-call channel
```

**Why:** Catches sudden bursts of 500s — usually a bad deploy or a provider outage.

### 3. Release regression

**Trigger:** A new release has more errors than the previous release within 1 hour.

```
When: new_issues() > 0
Over: 1h after release deploy
Per: release
Then: send to on-call channel + create Jira ticket
```

**Why:** The fastest way to catch a bad deploy. If the release is broken, auto-rollback or pin to the previous release.

---

## Brokerage alerts

### 4. Brokerage auth failure burst

**Trigger:** >5 `BROKERAGE_AUTH_ERROR` events in 15 minutes.

```
When: event count > 5
Over: 15m window
Filter: tags[errorCode] == BROKERAGE_AUTH_ERROR
Then: notify #engineering (Slack)
```

**Why:** A burst of SnapTrade auth failures usually means a provider-side token expiry or a broken integration. Individual failures are expected (users letting connections lapse); a burst signals a systemic issue.

### 5. Brokerage sync failure rate

**Trigger:** >20% of sync attempts failing over 30 minutes.

```
When: events matching tags[provider] == snaptrade AND event.level:error
      count / total_sync_attempts > 0.20
Over: 30m window
Then: notify #engineering (Slack)
```

**Why:** SnapTrade outages or rate-limit storms. Use the `connectionId` tag to identify affected workspaces.

---

## Market data alerts

### 6. FMP rate limiting

**Trigger:** >10 `rate_limited` events from FMP in 10 minutes.

```
When: event count > 10
Over: 10m window
Filter: tags[provider] == fmp AND tags[kind] == rate_limited
Then: notify #engineering (Slack)
```

**Why:** Approaching the FMP plan's rate ceiling. Check `FMP_RATE_LIMIT_CAPACITY` / `FMP_RATE_LIMIT_REFILL` in env and consider upgrading the plan or lowering the sample rate.

### 7. FMP provider outage

**Trigger:** >0 `auth_error` OR >20 `network_error`/`timeout` events in 5 minutes.

```
When: event count > 0
Over: 5m window
Filter: tags[provider] == fmp AND tags[kind] IN [auth_error, network_error, timeout]
Then: page on-call
```

**Why:** FMP is the sole market-data provider. An outage degrades the entire app (quotes, charts, profiles). Page immediately.

---

## Frontend alerts

### 8. Chunk load failure burst

**Trigger:** >5 `chunk_load` events in 5 minutes.

```
When: event count > 5
Over: 5m window
Filter: tags[kind] == chunk_load
Then: notify #engineering (Slack)
```

**Why:** Usually means a deploy is mid-flight (users on the old bundle trying to load new chunks). If it persists after the deploy completes, the build output may be broken.

### 9. Frontend error spike

**Trigger:** >15 new frontend errors in 5 minutes.

```
When: new issue count > 15
Over: 5m window
Filter: tags[component] == frontend
Then: notify #engineering (Slack)
```

---

## Performance budgets

Configure these as Sentry Performance Monitoring → Alerts (transaction-based).

### Backend

| Transaction | p95 threshold | Alert window |
| --- | --- | --- |
| API request (any) | > 500 ms | 15m |
| `/api/account/*` (portfolio load) | > 2,000 ms | 15m |
| `/api/app/bootstrap` (dashboard) | > 3,000 ms | 15m |
| Brokerage sync span (`brokerage.sync`) | > 10,000 ms | 30m |
| Market intel fetch (`market-intel.fetch`) | > 1,000 ms | 15m |

### Frontend

| Transaction | p95 threshold | Alert window |
| --- | --- | --- |
| Page load (any entry) | > 3,000 ms | 15m |
| Route transition | > 1,000 ms | 15m |
| Largest contentful paint | > 2,500 ms | 15m |
| INP (interaction to next paint) | > 200 ms | 15m |

**Creating a performance alert:**
```
Sentry → Performance → Alerts → Create Alert
When: transaction.duration p95 > <threshold>
Filter: transaction matches "<pattern>"
Over: <window>
Then: notify #engineering
```

---

## Notification channels

Recommended routing:

| Alert severity | Channel | Response time |
| --- | --- | --- |
| Critical (crash-free, release regression, FMP outage) | PagerDuty / on-call rotation | Immediate |
| Brokerage / market-data | `#engineering` Slack | During business hours |
| Frontend chunk loads / error spikes | `#engineering` Slack | Next business day |

---

## Dashboards

Create these custom dashboards in Sentry → Dashboards:

### "Zenin Overview"
- Crash-free session rate (backend + frontend, 7d)
- Error event count by project (24h)
- p95 API response time (24h)
- Active release + deploys

### "Brokerage Health"
- Sync success rate (24h)
- Auth error count by provider
- Sync duration p95
- Top failing connections (by `connectionId` tag)

### "Market Data Health"
- FMP request latency p95
- Cache hit rate (from breadcrumbs: `cache: hit` vs `cache: miss`)
- Rate-limit / timeout / auth error counts
