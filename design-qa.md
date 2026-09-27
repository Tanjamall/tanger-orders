# Analytics design QA

final result: passed

## Visual targets and evidence

- Overview source: C:/Users/SAEED/.codex/generated_images/01a070fd-be7f-7c41-8360-c5353891656d/exec-3b6cefe3-3d29-48c3-9271-bab170517665.png
- Products source: C:/Users/SAEED/.codex/generated_images/01a070fd-be7f-7c41-8360-c5353891656d/exec-3ef4b4e9-a773-401b-b388-857de5633133.png
- Rendered evidence: design-proposals/overview-final.jpg, products-final.jpg, mobile-final.jpg.
- Combined full comparisons: design-proposals/overview-comparison.jpg and products-comparison.jpg.
- Focused comparisons: design-proposals/overview-detail-comparison.jpg and products-detail-comparison.jpg.
- Desktop: 1488 x 1058 CSS px, DPR 1. Sources are 1487 x 1058; implementation screenshots are 1488 x 1058. One-pixel source-width difference retained, not stretched.
- Mobile: 390 x 844. Also inspected table overflow at 1100 x 900.
- State: light theme, September 2026, Overview and product selected. A local-only fixture provides Arabic/English names, 53 delivered orders, seven products and restocks. Figures and graph geometry legitimately differ from the illustrative mockups. This fixture is not a production build entry.
- Browser: Chrome fallback because the in-app capture had zoom/cropping inconsistencies. Real app interactions also tested in the existing dev demo.

## Comparison history

1. P2: Chart controls occupied an extra row. Moved metric controls alongside heading and group selector; legend remains beneath.
2. P2: Old card borders and tall metric cards diverged from the reference. Replaced with shallow text metrics, separators, cream page surface and measured desktop columns.
3. P2: Inspector lacked daily-sales context. Added a data-driven sales chart, zero-sales dates and monthly aggregation for long histories.
4. P2: Arabic fallback was too small/thin. Increased Arabic name size and weight while keeping mixed-language table alignment.
5. P2: Main-section spacing was taller than the overview target. Reduced header/KPI padding, compact-table rows and chart explanatory text; retained that explanation for accessibility.
6. Initial screenshots could not serve as final evidence because the browser was in a different route/scroll state. Re-captured and visually inspected both routes, then rebuilt combined comparisons from the verified captures.

Post-fix full and focused comparisons show no remaining actionable P0/P1/P2 layout defects. Desktop tables contain every column; mobile horizontal scrolling is confined to the table rather than the page.

## Required fidelity surfaces

- Typography: Fraunces display headings and Manrope UI/tabular figures, readable 14–17px desktop text; Arabic fallback sized explicitly. Dates and computed values use app formatting rather than copying generated raster text.
- Layout: full-width workspace, narrow pine global rail, compact summary strip, approximately 62/38 overview analysis columns, separate supporting row, table/inspector split when open. No nested card containers.
- Tokens: existing cream/pine/ink palette, mint selection tint, warm dividers, small-radius controls, restrained chart tooltip shadow. Dark mode preserves semantic colors.
- Assets: retained the actual Tanger Orders logo and existing Phosphor icon library. Charts and bars represent live values, not raster mock content.
- Copy/data: COD deliveries count as paid; misleading collection warning and export rows removed. Product, delivery, and other recorded costs reconcile to order profit. Confirmation bonuses are included in other order costs and remain itemized in CSV.

## Intentional integration differences

The two approved mocks differed in navigation. Use Overview's global Orders/Inventory/Profit/Analysis rail on every page, with report-page tabs above the contents, rather than replacing the app navigation on Products. This adds a report-navigation row to Products relative to its original image. The actual brand logo replaces the generated letter T. The full-history checkbox and scrollable event list preserve complete history rather than a decorative three-event preview. Deeper existing operations/weekday analysis remains available in a collapsed section. Actual data determines values, rows, graph shape, comparisons and empty states; fabricated mock changes/percentages are not displayed.

## Validation

- TypeScript strict unused checks passed.
- 27 domain tests passed.
- Production build passed (existing bundle-size advisory only).
- Product inspector hidden initially; clicking selected product opens, clicking again closes; explicit close and Escape supported.
- Customer and inventory report navigation and table containment checked.
- Custom range applied (1–20 September), updated totals to an empty period, and closed the date form; presets restore the report.
- Chart metric selection, period controls and grouping exercised.
- All five report routes have equal scroll-container width and scrollWidth at 390px (no page overflow).
- Full-data table checks passed at 1100px and 1488px.
- Browser console check reported no errors or warnings in the app demo.

## Follow-up polish

P3: Browser font rasterization differs slightly from generated images. Calendar labels follow locale conventions (Sept). These do not alter structure or readability.
