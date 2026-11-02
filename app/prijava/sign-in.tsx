"use client";

import { Button } from "@/components/ui/button";
import { sign_in_with_google, sign_out } from "@/lib/auth-client";

export function SignIn({ email }: { email: string | null }) {
  if (!email) {
    return <Button onClick={() => sign_in_with_google()}>Prijava z Googlom</Button>;
  }
  return (
    <>
      <p className="text-sm">Prijavljeni ste kot {email}.</p>
      <Button
        variant="secondary"
        onClick={async () => {
          await sign_out();
          location.reload();
        }}
      >
        Odjava
      </Button>
    </>
  );
}
