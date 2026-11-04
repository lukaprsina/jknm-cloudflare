import Link from "next/link";

/** The 404 copy, shared by the page inside the site shell and the bare root fallback. */
export function NotFoundContent() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-6 py-24 text-center">
      <p className="text-6xl font-bold text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Stran ne obstaja</h1>
      <Link href="/" className="text-primary underline-offset-4 hover:underline">
        Nazaj na domačo stran
      </Link>
    </div>
  );
}
