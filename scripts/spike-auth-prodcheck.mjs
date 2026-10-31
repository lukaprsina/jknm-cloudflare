// READ-ONLY: SELECTs only against production. Prints counts/schema facts, no PII.
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.SPIKE_DATABASE_URL });
await c.connect();
await c.query("begin read only"); // NOT a session-level SET: it leaked through the Supavisor transaction pooler
const q = async (label, sql) => {
  const r = await c.query(sql);
  console.log(label, JSON.stringify(r.rows));
};
await q(
  "account columns",
  `select column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='account' order by ordinal_position`,
);
await q(
  "account indexes",
  `select indexname from pg_indexes where schemaname='public' and tablename='account' order by 1`,
);
await q(
  "issuer col present",
  `select count(*)::int as n from information_schema.columns where table_schema='public' and table_name='account' and column_name='issuer'`,
);
await q(
  "dup provider_id,account_id",
  `select count(*)::int as dup_groups from (select provider_id, account_id from account group by 1,2 having count(*)>1) t`,
);
await q(
  "counts",
  `select (select count(*) from "user")::int as users, (select count(*) from session)::int as sessions, (select count(*) from account)::int as accounts, (select count(*) from verification)::int as verification`,
);
await q("provider ids", `select provider_id, count(*)::int as n from account group by 1`);
await q(
  "sessions live",
  `select count(*) filter (where expires_at > now())::int as live, count(*)::int as total from session`,
);
await q(
  "user email domains ok",
  `select count(*) filter (where lower(email) like '%@jknm.si')::int as jknm, count(*)::int as total, count(*) filter (where email_verified)::int as verified from "user"`,
);
await q(
  "user table cols",
  `select column_name, is_nullable from information_schema.columns where table_schema='public' and table_name='user' order by ordinal_position`,
);
await q(
  "session/verification cols",
  `select table_name, string_agg(column_name, ',' order by ordinal_position) as cols from information_schema.columns where table_schema='public' and table_name in ('session','verification') group by 1`,
);
await q(
  "account nulls issuer",
  `select count(*) filter (where issuer is null)::int as null_issuer from account`,
).catch((e) => console.log("issuer query:", e.message));
await c.end();
