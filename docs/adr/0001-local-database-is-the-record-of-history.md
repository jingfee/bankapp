# The local database is the permanent record of transaction history

Banks only return a limited window of history through Enable Banking: often about 90 days, with longer history available only shortly after a connection is granted. Anything we don't store ourselves is eventually lost for good. So the app's SQLite database, not the bank, is the record of history. Booked transactions are never deleted (pending ones, which the bank may still change or drop, are replaced on each sync; amended by ADR 0005, they now keep their identity until booked), the raw bank response for each transaction is kept next to the parsed fields, and the database is backed up daily.

## Consequences

- Rules for removing duplicates or reading fields can change later and be re-applied to the stored raw responses, without fetching again.
- Losing the database loses history the banks can no longer return, which is why daily backups (a `VACUUM INTO` copy picked up by the homelab backup) are part of the app, not an afterthought.
