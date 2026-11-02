import type { Metadata } from "next";
import { CONTACT_EMAIL } from "@/lib/domains";
import { get_session } from "@/server/auth/session";
import { SignIn } from "./sign-in";

export const metadata: Metadata = {
  title: "Prijava",
  robots: { index: false, follow: false },
};

export default async function Prijava() {
  const session = await get_session();
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Prijava</h1>
      <p className="text-sm text-muted-foreground">
        Prijava je možna samo z Google računom {CONTACT_EMAIL}.
      </p>
      <SignIn email={session?.user.email ?? null} />
    </main>
  );
}
