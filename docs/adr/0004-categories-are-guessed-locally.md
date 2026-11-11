---
status: accepted
---

# Categories are guessed locally, never by an external AI or cloud service

Transaction descriptions show where and with whom the owner spends money, so they must not leave the owner's server. The app guesses categories with methods that run entirely inside the backend: it reuses the owner's earlier confirmed categories for the same description, falls back to a built-in list of Swedish merchant keywords, and uses a small text classifier trained only on the owner's own confirmed categories. A guess below a confidence threshold is not made at all, and the transaction stays uncategorised.

## Considered Options

- **A hosted language model (e.g. an LLM API):** better cold-start guesses for unknown merchants, rejected because every description would be sent to a third party.
- **A bank or aggregator categorisation feature:** not available consistently through Enable Banking, and would tie categories to an outside taxonomy.

## Consequences

- Guesses for merchants the owner has never confirmed rely on the keyword list and are weaker than a hosted model's would be; confirming a few transactions is how quality improves.
- Adding any categorisation dependency that calls out over the network breaks this decision and needs a new ADR.
