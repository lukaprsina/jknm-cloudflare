// Spike helper: create/drop ONLY the scratch table spike_hyperdrive_probe. Usage: spike-env.sh node scripts/spike-scratch.mjs create|drop|dump
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.SPIKE_DATABASE_URL });
await c.connect();
const cmd = process.argv[2];
if (cmd === "create")
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
