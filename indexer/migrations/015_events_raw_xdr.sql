-- P4-10 (I-6): archive the raw XDR alongside the decoded JSON so a
-- decoder bug stays recoverable after RPC retention expires.
-- topic_xdr is a JSON array of base64 ScVals, value_xdr a single
-- base64 ScVal; both captured before decoding. Rows from before this
-- migration stay NULL.

ALTER TABLE events_raw ADD COLUMN topic_xdr TEXT;

--# split

ALTER TABLE events_raw ADD COLUMN value_xdr TEXT;
