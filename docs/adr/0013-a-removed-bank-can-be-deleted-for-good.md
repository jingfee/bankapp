---
status: accepted
---

# A removed bank can be deleted for good

Amends [0001](0001-local-database-is-the-record-of-history.md). Booked transactions are still never deleted by the app on its own, but the owner can now erase a bank and everything it brought in, on purpose.

Removing a bank is the normal way to stop using one: it stops syncing, its access is revoked, and its accounts become closed accounts whose transactions keep counting as history. Removing it changes nothing in past months or settlements, and connecting the bank again continues where it left off. Deleting for good is a second, separate step, offered only for a bank that is already removed and confirmed by typing the bank's name. It erases the bank, its connection, its accounts, their transactions and their balance history. The owner wanted a way to make a bank's data actually gone, not only out of sight. The two steps make deleting it by accident unlikely.

## Consequences

Accepted as the cost of deleting for good:

- Past overview months lose the deleted transactions.
- The settlement balance and past settlement periods change if any of them were shared. What was paid never changes, so the balance moves by their partner's part.
- Refunds offset against deleted purchases lose the link, keep their category and count in their own month again (Offset).
- Manual transactions that a deleted transaction replaced come back (Replace).
- Settlement reports already saved to disk keep the old figures until they are saved again.
- Nightly backups still hold the data until they rotate out, up to 7 days.
