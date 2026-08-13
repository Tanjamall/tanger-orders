# Tanger Orders architecture

This project is organized by responsibility so changes have a predictable home.

## Main modules

- `src/App.tsx` — application orchestration: session state, Supabase synchronization, mutations, page selection, and modal state.
- `src/domain/orders.ts` — order and inventory business rules, canonical statuses, date formatting, totals, and shared domain types.
- `src/features/orders/DesktopOrders.tsx` — desktop order workspace, sidebar, ledger, pagination, and contextual order details.
- `src/features/orders/OrderComponents.tsx` — shared order form and mobile order card.
- `src/components/ui.tsx` — small reusable UI primitives such as headers, navigation buttons, empty states, metrics, and modals.
- `src/types.ts` — persisted data shapes shared by the application and Supabase mapping.
- `src/data.ts` — development/demo fixtures.
- `src/quiet-ledger.css` — current visual system and responsive layouts.
- `src/styles.css` — base and legacy application styles.

## Where future changes should go

- New order status, payment status, date, or inventory calculation: `src/domain/orders.ts`.
- Desktop order layout or interactions: `src/features/orders/DesktopOrders.tsx`.
- Mobile order row or add/edit order fields: `src/features/orders/OrderComponents.tsx`.
- Shared button, modal, header, or empty state: `src/components/ui.tsx`.
- Supabase loading or mutations: currently `src/App.tsx`; move to a dedicated service or hook when that area is next changed substantially.
- Visual-only changes: `src/quiet-ledger.css`, keeping desktop rules inside the existing desktop media query.

## Verification

Run these before deployment:

```powershell
npm.cmd run check
npm.cmd run build
```

`check` catches TypeScript errors, unused imports, unused variables, and unused parameters. `build` verifies the production bundle.

## Refactoring rule

Prefer extracting a module when a feature gains its own state, business rules, or multiple UI components. Avoid moving code merely to make files shorter; modules should represent stable responsibilities.
