// Scratch Postgres schema `spike_tmp_auth` (user/session/account/verification, no issuer) in the
// production DB: create + seed one user/session, or drop it. Never touches public.* tables.
//   node scripts/spike-auth-scratch.mjs up   -> prints nothing secret; writes /tmp/spike-auth-cookie
//   node scripts/spike-auth-scratch.mjs down
// Needs SPIKE_DATABASE_URL and BETTER_AUTH_SECRET (the throwaway spike secret) in the env.
import { writeFileSync } from "node:fs";
import pg from "pg";

const S = "spike_tmp_auth";
const c = new pg.Client({ connectionString: process.env.SPIKE_DATABASE_URL });
await c.connect();
const cmd = process.argv[2];
await c.query("set default_transaction_read_only = off"); // a prior read-only SET leaked through the transaction pooler

if (cmd === "down") {
  await c.query(`drop schema if exists ${S} cascade`);
  const r = await c.query(`select to_regnamespace('${S}') as n`);
  console.log("dropped; to_regnamespace =", r.rows[0].n);
} else if (cmd === "up") {
  await c.query(`drop schema if exists ${S} cascade`);
  await c.query(`create schema ${S}`);
  await c.query(`
    create table ${S}."user" (id varchar(255) primary key, name varchar(255) not null, email varchar(255) not null unique,
      email_verified boolean not null default false, image varchar(255),
      created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table ${S}.session (id varchar(255) primary key, user_id varchar(255) not null references ${S}."user"(id) on delete cascade,
      token varchar(255) not null unique, expires_at timestamptz not null, ip_address text, user_agent text,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table ${S}.account (id varchar(255) primary key, user_id varchar(255) not null references ${S}."user"(id) on delete cascade,
      account_id varchar(255) not null, provider_id varchar(255) not null, access_token text, refresh_token text,
      access_token_expires_at timestamptz, refresh_token_expires_at timestamptz, scope text, id_token text, password text,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table ${S}.verification (id varchar(255) primary key, identifier varchar(255) not null, value text not null,
      expires_at timestamptz not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  `);
  await c.query(
    `insert into ${S}."user"(id,name,email,email_verified) values ('u1','Spike Editor','spike@jknm.si',true)`,
  );
  const token = "spike-token-" + Math.random().toString(36).slice(2);
  await c.query(
    `insert into ${S}.session(id,user_id,token,expires_at) values ('s1','u1',$1, now() + interval '1 hour')`,
    [token],
  );
  const secret = process.env.BETTER_AUTH_SECRET;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token)),
  );
  const value = encodeURIComponent(`${token}.${btoa(String.fromCharCode(...sig))}`);
  writeFileSync("/tmp/spike-auth-cookie", `better-auth.session_token=${value}`);
  writeFileSync("/tmp/spike-auth-cookie-secure", `__Secure-better-auth.session_token=${value}`);
  console.log("scratch schema ready; cookie written to /tmp/spike-auth-cookie");
}
await c.end();
