# Analytics workspace

## Research and structure

Reviewed September 26, 2026:

- [Shopify analytics overview](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/overview-dashboard/using-the-overview-dashboard): period filters, comparisons, key metrics, and drill-down reports.
- [WooCommerce analytics](https://woocommerce.com/document/woocommerce-analytics/): summary indicators, chart metrics, sortable detail tables, and CSV exports.
- [Shopify inventory reports](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/inventory-reports): inventory value, sales velocity, and stock planning.
- [Supabase range queries](https://supabase.com/docs/reference/javascript/using-modifiers-range): ordered, inclusive pagination.

The implementation follows that information hierarchy while retaining Tanger Orders' paper, green, serif, and monospaced visual language. Desktop uses the full width available beside the navigation, with a four-metric overview, an 8/4 trend-and-cost split, full-width product and inventory tables, and supporting delivery/customer/payment panels. On small screens, reports stack and tables scroll within their own containers.

Analytics navigation switches between independent Overview, Products, Customers, Inventory, and About views using `#analysis/<view>` URLs, with browser Back/Forward support. Date filters stay shared while switching views. Overview contains financial, delivery, payment, and timing reports; product history lives on Products. Desktop body text is 14–15px and KPI cards use compact vertical spacing.

## Decisions this report supports

| Decision | Measures | Basis |
| --- | --- | --- |
| Are we growing profitably? | Delivered revenue, order profit, margin, orders, AOV, previous-period changes | Delivered orders by delivery date |
| Which products deserve investment? | Units, revenue, allocated cost, profit, margin, revenue share, full product history | Selected period; sortable and searchable |
| Are deliveries working? | Current status distribution, closed-order success/cancellation rates, average delivery time | Statuses use creation cohort; duration uses selected deliveries with valid timestamps |
| Are buyers returning? | Unique identified buyers, repeat-buyer share, top customer revenue | Normalized phone numbers; 2+ delivered orders by period end |
| Has delivered revenue been collected? | Marked paid and not marked paid | Current payment status of deliveries in selected period |
| Where is inventory at risk? | Available stock, low stock, 30-day demand, estimated cover, idle stock, current cost value | Current snapshot independent of report period; bundles consume component demand |
| When are we strongest? | Daily/monthly revenue and profit, weekday profit, best date and month | Selected delivery dates; zero-activity days included |

## Definitions and limitations

- All reporting event dates use Africa/Casablanca. Range endpoints are inclusive. The previous period has the same calendar length, ending the day before the selected range. Month-to-date includes the current partial day.
- Order profit = item revenue − recorded product cost − delivery − confirmation bonus − other order expenses. It is intentionally not called accounting net profit. Overhead, advertising, tax, refunds, returns, and failed-delivery costs are not fully modeled.
- Product shared costs are allocated proportionally to revenue, falling back to quantities for free orders. Repeated product lines count once per order. Product order counts must not be summed as unique order totals.
- Missing delivery dates fall back to creation dates. Missing historical item costs fall back to current catalog costs. The data-quality section reports affected orders.
- Repeat-buyer share includes buyers with multiple deliveries within the selected period as well as deliveries before it. It excludes orders after the selected end date. No usable phone number means exclusion, rather than incorrectly merging anonymous buyers.
- Payment status is not a cash ledger: there are no payment timestamps or partial-payment amounts.
- Inventory valuation uses current catalog costs and excludes virtual bundles. Cover uses the last 30 calendar days' delivered demand, including zero days and bundle component demand. It does not account for open-order reservations or supplier lead times and is not a forecast.
- Restock spending uses receipts marked `restock`; opening balances and corrections are excluded. Purchases are not charged a second time against delivered-order profit.
- Full product history shows recorded orders and inventory receipt events. It is not a complete audit trail of status edits, note changes, or individual stock allocations.
- The page warns while data is loading or failed and disables exports until analytics resources finish loading.

## Preparing for growth

Orders, products, and inventory receipts are fetched in ordered pages, rather than relying on the API's first response. Exact counts detect truncated responses and changes in collection size during loading. Results are committed only after all pages succeed. These are not transactionally consistent snapshots across tables; a reporting RPC or materialized reporting layer is the next step at substantially larger volumes.

Recommended future data collection, in order:

1. Structured acquisition source and campaign on orders; dated campaign spend, for acquisition cost and ROAS.
2. Refund/return events, cancellation reasons, and actual failed-delivery costs, for complete order economics.
3. Payment timestamps and amounts, fees, overhead, and taxes, for cash flow and accounting profit.
4. Structured delivery zones and immutable status timestamps, for regional performance and operational bottlenecks.
5. Supplier lead times and purchase orders, for reorder points and stockout planning.
6. Storefront visits and checkout events, for conversion funnels. Order records alone cannot provide conversion rates.

No synthetic conversion, advertising, or accounting figures are shown in the dashboard. CSV exports include scope and calculation notes, full product rows, delivery-date totals, payment/status summaries, customer aggregates, and a separately labeled inventory snapshot.

## Validation

`npm run test:domain` covers comparisons, zero-activity dates, cost reconciliation, customer matching, cohort dates, payment amounts, bundle stock, empty reports, CSV escaping, and multi-page reads. Browser checks use local demo data and a separate synthetic fixture; no customer records are modified.
