"use client";
import { useState } from "react";

export function ActionButtons({
  result,
  thrower,
}: {
  result: (n: number) => Promise<unknown>;
  thrower: () => Promise<unknown>;
}) {
  const [out, setOut] = useState("");
  return (
    <div>
      <button id="res-ok" onClick={async () => setOut("ok:" + JSON.stringify(await result(2)))}>
        result ok
      </button>
      <button id="res-err" onClick={async () => setOut("err:" + JSON.stringify(await result(-1)))}>
        result err
      </button>
      <button
        id="throw"
        onClick={async () => {
          try {
            await thrower();
            setOut("no throw");
          } catch (e) {
            setOut(
              "caught:" + (e as Error).message + "|digest=" + (e as { digest?: string }).digest,
            );
          }
        }}
      >
        throw
      </button>
      <pre id="out">{out}</pre>
    </div>
  );
}
