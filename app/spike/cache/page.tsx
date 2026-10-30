import {
  bumpNoInvalidate,
  bumpRevalidateTag,
  bumpRevalidateTagMax,
  bumpUpdateTag,
  resultAction,
  throwingAction,
} from "../actions";
import { readCachedProbe } from "@/lib/spike/cached";
import { withRequestDb } from "@/lib/spike/pg-db";
import { ActionButtons } from "./buttons";

export const dynamic = "force-dynamic";

export default async function Page() {
  const v = await withRequestDb(() => readCachedProbe());
  return (
    <main>
      <pre id="state">{JSON.stringify({ counter: v.counter, readAt: v.readAt })}</pre>
      <form action={bumpUpdateTag}>
        <button id="update">bump+updateTag</button>
      </form>
      <form action={bumpRevalidateTag}>
        <button id="revalidate">bump+revalidateTag</button>
      </form>
      <form action={bumpRevalidateTagMax}>
        <button id="revalidate-max">bump+revalidateTag max</button>
      </form>
      <form action={bumpNoInvalidate}>
        <button id="none">bump only</button>
      </form>
      <ActionButtons result={resultAction} thrower={throwingAction} />
    </main>
  );
}
