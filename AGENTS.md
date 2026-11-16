# Repository Agent Rules

## P0 — Desktop-only UI/UX scope (MANDATORY)

**DEFAULT AND ENFORCED SCOPE: DESKTOP ONLY, viewport width >= 1024px.**

1. **PROHIBITED:** Do not design, implement, refactor, optimize, or otherwise work on **Mobile or Tablet UI/UX**. Do not add small-screen responsive breakpoints, layouts, drawers, navigation modes, touch-target adaptations, or device-specific behavior.
2. **PROHIBITED:** Do not create Mobile/Tablet screenshots, mockups, fixtures, Playwright test runs, visual regressions, documentation, implementation plans, or acceptance criteria for those devices.
3. **PROHIBITED:** Never interpret “audit the whole frontend”, “all screens”, “responsive”, “professional UX”, or “best practices” as permission to expand a Desktop task to Mobile/Tablet.
4. **REQUIRED:** All new UI/UX work, layouts, screenshots and viewport tests must be Desktop-only. Use Desktop targets such as `1366×768`, `1440×900` and `1920×1080`.
5. **REQUIRED:** Keep changes scoped to Desktop CSS and behavior. Shared component modifications must not introduce Mobile/Tablet functionality. No new breakpoint rule targeting widths below `1024px`.
6. **REQUIRED:** If a task seems to require Mobile/Tablet work, do **not** perform it by assumption. Report that work as out of scope; only an **explicit new request from the repository owner** can override this rule for that specific task.
7. **REQUIRED:** Preserve working Desktop features and functionality. Never roll back unrelated application code to remove small-screen artifacts.

This rule takes precedence over old UI/UX documentation, generic responsive-design recommendations, and implied cross-device testing.
