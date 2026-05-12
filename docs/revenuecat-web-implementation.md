# RevenueCat Web Billing for Zenin

This app now includes the RevenueCat Web SDK via `@revenuecat/purchases-js` and exposes the integration in `Workspace Settings -> Subscription`.

## What was added

- SDK install with npm:
  - `npm --prefix frontend install --save @revenuecat/purchases-js`
- RevenueCat wrapper:
  - `frontend/src/utils/revenueCat.js`
- Subscription management UI:
  - `frontend/src/App.jsx`
- RevenueCat styles import:
  - `frontend/src/App.jsx`

## API key

The current web public API key is configured in:

- `frontend/src/utils/revenueCat.js`

Recommended follow-up:

- Move the key into `VITE_REVENUECAT_WEB_API_KEY` for environment-based configuration.

## How the implementation works

### 1. SDK initialization

Zenin uses identified customers for RevenueCat, using the signed-in Zenin user ID:

```js
const purchases = Purchases.configure({
  apiKey: WEB_BILLING_PUBLIC_API_KEY,
  appUserId: zeninUserId
});
```

This matches RevenueCat's recommended identified-customer setup for authenticated apps.

### 2. Customer attributes

The wrapper sets RevenueCat customer attributes for:

- `$email`
- `$displayName`

This helps prefill checkout and improve customer support visibility.

### 3. Customer info retrieval

The app loads:

- `getCustomerInfo()`
- `getOfferings()`

and uses RevenueCat entitlements and active subscriptions to determine access state in the UI.

### 4. Purchase flows

The app supports both:

- direct package purchase with `purchase({ rcPackage })`
- a managed RevenueCat paywall with `presentPaywall({ htmlTarget, offering })`

### 5. Subscription self-service

For web, the most relevant customer management surface is the RevenueCat Web Billing customer portal exposed through `customerInfo.managementURL`.

The app uses that URL for the `Manage Subscription` button.

## RevenueCat dashboard setup

RevenueCat's docs recommend creating products, entitlements, and offerings before using the SDK:

- Web SDK:
  - https://www.revenuecat.com/docs/web/web-billing/web-sdk
- Products & prices:
  - https://www.revenuecat.com/docs/web/web-billing/product-setup
- Offerings:
  - https://www.revenuecat.com/docs/offerings/overview
- Web paywalls:
  - https://www.revenuecat.com/docs/web/paywalls
- Customer portal:
  - https://www.revenuecat.com/docs/web/web-billing/customer-portal

### Recommended Zenin setup

Entitlements:

- `zenin_pro`
- `zenin_desk`

Products:

- `zenin.pro.monthly`
- `zenin.pro.yearly`
- `zenin.desk.monthly`
- `zenin.desk.yearly`

Offering:

- `default`

Recommended package composition:

- monthly package for `zenin.pro.monthly`
- annual package for `zenin.pro.yearly`
- custom package for `zenin.desk.monthly`
- custom package for `zenin.desk.yearly`

## Paywall guidance

RevenueCat Paywalls on web are supported through `presentPaywall()` from the Web SDK. In Zenin, the paywall is mounted into the subscription settings panel.

Recommended paywall content:

- Starter vs Pro vs Desk comparison
- annual savings messaging
- clear feature bullets
- express checkout enabled for Apple Pay / Google Pay where available

## Customer Center note

For web, RevenueCat's Web Billing customer portal is the best fit today for subscription self-service. The app uses `customerInfo.managementURL` for this.

If you want a native-style Customer Center inside mobile apps later, add that separately in the mobile SDKs. For the current web app, the portal is the correct management path.

## Best practices

- Configure RevenueCat only once per app session.
- Use identified customers for Zenin's authenticated users.
- Prefer entitlements for access checks instead of hardcoding product IDs.
- Use offerings and the `current` offering instead of hardcoding package identifiers in UI logic.
- Handle `UserCancelledError` as a non-error outcome.
- Use `customerInfo.managementURL` for subscription management.
- Keep product IDs stable. For price changes, RevenueCat recommends creating new web billing products and swapping them into the offering.
- For stronger backend enforcement, add RevenueCat webhooks later so server-side plan state stays in sync without relying on client refresh.

## Suggested next step

After you configure products and offerings in RevenueCat:

1. Open Zenin
2. Sign in
3. Go to `Workspace Settings -> Subscription`
4. Click `Refresh RevenueCat`
5. Verify packages appear
6. Test `Purchase Package`
7. Test `Present RevenueCat Paywall`
8. Complete a sandbox purchase
9. Confirm `Manage Subscription` opens the RevenueCat management URL
