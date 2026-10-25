# DEKEZ portal visual consistency

## Reference and scope

The existing Client Owner portal is the visual reference, not a new application template. Its main components are `components/owner/portal.tsx` and `portal.module.css`: 232px dark desktop sidebar at 1024px, safe-area mobile bottom navigation, fluid content, cream canvas, ivory cards, gold accents and Arial typography.

Before this update the internal Admin/Management/Tenant/Staff portals shared `AppShell` and `components/ui` primitives, with an earlier colour-only polish. Tenant still had the mobile-style bottom navigation on desktop, narrow header/content caps and dark header. Management also retained a dark header. Contractor used a separate responsive CSS module with similar colours but different cards/header styling. Chat used its own component stylesheet. There is no independent accounting-role portal: accounting pages use the existing permission-controlled internal shell.

## UI-only changes

- `app/portal-tokens.css`: one shared palette and decorative tokens copied from the approved Owner appearance. No new dependency or runtime data request.
- `app/globals.css`: screen-only Owner-style headers, cards, buttons, fields, table surfaces and navigation. Internal and Tenant content use the available width. The original decorative pattern is replaced by the Owner cream surface within these shells; no data is removed.
- `components/app-shell.tsx`: presentation classes, active-link accessibility attributes and existing-logo sidebar branding only. Tenant's existing four navigation links become its desktop sidebar; the same links stay in the mobile bottom bar. Management's complete existing scrollable menu and Admin/Staff mobile drawer/shortcuts remain available. Menu definitions, filtering, links, handlers, logout and language behavior are unchanged.
- `components/ui/{card,button,table}.tsx`: stable style hooks only. Variants, props, children, events and semantics remain unchanged. Danger and semantic status colours are retained. Existing blue/green payment-verification classification is not overridden.
- `components/marketplace/contractor-portal.module.css`: shared-token header, cards, typography and button decoration; same Contractor pages/navigation.
- `components/chat/{workspace,launcher}.module.css`: matching surfaces, bubbles, controls and bubble-icon treatment. Red unread badge stays red and keeps the existing count logic. No chat/assistant/reminder code or access rule changed in this task.

Owner portal components/data/styles, all APIs, auth/access modules, database migrations, calculations and server actions are untouched by this UI task. The working directory already contained the separate pending chat/reminder/assistant implementation; those changes must not be bundled into a UI production release without their separate approval.

## Table and navigation choices

Shared tables retain every column, label, row and action. Dense accounting tables scroll inside their existing bounded wrapper on mobile; the page itself does not scroll sideways. No automatic card conversion is attempted without reliable per-column labels. Existing card-based lists retain their content.

Desktop sidebars are 232px, with a 1024px transition. Tenant/Owner/Contractor keep their appropriate mobile bottom navigation. Internal Admin/Staff retain their existing mobile drawer for the complete menu, alongside existing shortcuts. Management retains its existing scrollable navigation strip, so no allowed destination is silently removed just to fit the screen.

## Verification and preview

`tests/portal-consistency.cjs` renders actual components with synthetic data and no live service access. Before snapshots are preserved under `artifacts/portal-consistency/before`. It compares existing content, links, fields, actions, required/disabled state and checks horizontal overflow. It renders Owner Home/Properties/Finance/Documents/Profile, Admin and Management Claims, Tenant Home, Contractor Dashboard/Profile/Quotations, a Staff shell and an accounting shared-table specimen. This is representative shared-component coverage, not a claim that every production record/page has been opened.

Viewports: 320×568, 375×812, 390×844, 430×932, 768×1024, 820×1180, 1024×768, 1024×1366, 1280×800, 1366×768, 1440×900, 1920×1080, 2560×1440. The matrix contains 169 before/after comparisons. Screenshots at 390, 820 and 1440 are in the local review page.

`tests/portal-consistency.test.cjs` checks normalized component syntax against the saved before files, excluding only styling hooks, active-link accessibility and decorative sidebar branding. Existing non-presentation logic must remain identical. It also checks the shared palette, red unread badge and preserved danger variants. Keep the before source snapshots with this review test.

Run the existing prebuild/build, TypeScript and interactive chat browser regression suite as well. The local fixtures do not test live authentication, Supabase WebSocket transport or production permissions; no live data or financial submissions are used. Existing authorization regression tests remain mandatory.

Observed local results on 25 October 2026: all 541 existing prebuild tests passed, the production build passed, standalone TypeScript checking passed, all three new UI-only tests passed, and all 169 before/after comparisons passed. The interactive chat browser suite passed on rerun across its 12 viewports. Its first run, concurrent with the build, hit the previously observed read-badge timeout; no chat behavior was changed to suppress it. Keep that timing case on the live-review checklist. There is no configured lint command. Build evidence is `artifacts/portal-consistency/build.log` and the visual matrix is `results.json` in the same folder.

The React review kept the change to CSS and presentation markup: no new hooks, data waterfalls, dependencies or cross-user state were added. Existing handlers and props are checked by the component-syntax comparison.

## Release boundary

### Isolated approved release — 25 October 2026

The release branch is based on verified production/main `006e747`. Only the presentation delta is included; the earlier pending assistant, reminders, Admin message-center, package and cron changes are excluded. The exact isolated release passed 475 existing prebuild tests, three UI-only tests, TypeScript, production build and 169 visual comparisons. The interactive chat browser suite passed on its standalone rerun; its first run hit the existing unread-badge timeout. No application/chat code was changed to hide that timing issue. Six existing dependency advisories remain (one critical, four high, one moderate); dependency upgrades are outside this UI-only release and require a separate security update. No production data was used for tests.

This is a local review, not a production deployment. Review `artifacts/portal-consistency/review.html` first. Before an approved UI-only release, integrate current production changes and isolate these presentation files from the pending assistant/reminder migrations, worker routes and cron changes. Run the existing release checks again. No database migration, service configuration or accounting change is needed for this UI update. Rollback is the presentation-file release only; do not revert unrelated chat work or change data.
