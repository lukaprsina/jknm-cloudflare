import { KitchenSink } from "./kitchen-sink";

export const metadata = { title: "Kitchen sink" };

export default function KitchenSinkPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-10 p-8">
      <h1 className="text-2xl font-semibold">Kitchen sink</h1>
      <KitchenSink />
    </main>
  );
}
