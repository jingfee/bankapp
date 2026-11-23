---
status: accepted
---

# The shared package stays types-only; the frontend shows values the backend sends

An architecture review found domain rules written twice, once in the backend and once in the frontend: month and day arithmetic, the household ratio in force on a day (ADR 0011), and the estimated interest on a loan part. One copy had already drifted: Bolån worked out a loan part's monthly interest at today's rate, while the backend used the rate in force on the 1st of the month. The obvious fix is to put the rule in `@bankapp/shared` and import it on both sides.

That does not work in production. The runtime image installs only the backend's production dependencies (`pnpm --filter @bankapp/backend deploy --prod`), and `@bankapp/shared` is a devDependency that the backend imports types from. A function in `shared` would pass every test, which run from source, and fail when the image starts.

So `@bankapp/shared` stays types-only for the backend: API types, plus the palette, icons and default categories the frontend uses. When the frontend needs a domain value, such as the interest on a loan part or which household ratio entry is in force, the backend works it out and sends it in the response. The frontend keeps only rules that are about the UI, such as moving between months in a picker or formatting dates, and these never feed back into the backend.

## Considered Options

- **Make `shared` a runtime package:** build it to JavaScript, make it a production dependency of the backend and point Node at the build. One copy of each rule, but a build step, a second resolution path for Angular and Vitest, and a production failure that tests cannot catch, mainly to deduplicate small date helpers.
- **Copy the rule on both sides and test both:** keeps working until someone changes one copy, as the interest calculation showed.

## Consequences

- A value the frontend wants to show is added to the API response, not worked out again in the page.
- Helpers duplicated within one side are gathered on that side: `backend/src/calendar.ts` and `frontend/src/app/dates.ts`.
- If the backend is ever bundled with its dependencies, this decision can be revisited.
