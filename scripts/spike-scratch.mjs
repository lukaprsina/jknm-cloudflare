// Spike helper: create/drop ONLY the scratch table spike_hyperdrive_probe. Usage: spike-env.sh node scripts/spike-scratch.mjs create|drop|dump
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.SPIKE_DATABASE_URL });
await c.connect();
const cmd = process.argv[2];
if (cmd === "plumb-create") {
  await c.query(
    `create table if not exists spike_plumb_log (id serial primary key, at timestamptz not null default now(), kind text not null, detail text not null default '')`,
  );
  await c.query(
    `create table if not exists spike_hyperdrive_probe (id serial primary key, label text not null, counter integer not null default 0, created_at timestamptz not null default now())`,
  );
  await c.query(
    `insert into spike_hyperdrive_probe(label,counter) select x,0 from (values ('cache'),('cronmode')) v(x) where not exists (select 1 from spike_hyperdrive_probe p where p.label=v.x)`,
  );
} else if (cmd === "plumb-drop") {
  await c.query(`drop table if exists spike_plumb_log`);
  await c.query(`drop table if exists spike_hyperdrive_probe`);
} else if (cmd === "plumb-sql") await console.log((await c.query(process.argv[3])).rows);
else if (cmd === "create")
  await c.query(
    `create table if not exists spike_hyperdrive_probe (id serial primary key, label text not null, counter integer not null default 0, created_at timestamptz not null default now())`,
  );
else if (cmd === "drop") await c.query(`drop table if exists spike_hyperdrive_probe`);
else if (cmd === "dump")
  console.log(
    (await c.query(`select id,label,counter from spike_hyperdrive_probe order by id`)).rows,
  );
else if (cmd === "exists")
  console.log((await c.query(`select to_regclass('public.spike_hyperdrive_probe') as t`)).rows[0]);
await c.end();
console.log("done", cmd);
