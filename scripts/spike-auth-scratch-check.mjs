// Counts rows in the scratch schema (written by sign-in/social state + seed).
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.SPIKE_DATABASE_URL });
await c.connect();
await c.query("set default_transaction_read_only = off");
console.log(
  (
    await c.query(
      "select (select count(*) from spike_tmp_auth.verification)::int as verification_rows, (select count(*) from spike_tmp_auth.session)::int as sessions",
    )
  ).rows[0],
);
await c.end();
