import { readPlumb } from "@/lib/spike/plumb-cached";
import {
  bumpNoInvalidate,
  bumpRevalidateTag,
  bumpRevalidateTagMax,
  bumpUpdateTag,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function Page() {
  const v = await readPlumb();
  return (
    <main>
      <pre id="state">{JSON.stringify(v)}</pre>
      <form action={bumpNoInvalidate}>
        <button>bumpNoInvalidate</button>
      </form>
      <form action={bumpUpdateTag}>
        <button>bumpUpdateTag</button>
      </form>
      <form action={bumpRevalidateTag}>
        <button>bumpRevalidateTag</button>
      </form>
      <form action={bumpRevalidateTagMax}>
        <button>bumpRevalidateTagMax</button>
      </form>
    </main>
  );
}
