"use client";

import { createAuthClient } from "better-auth/react";

/**
 * The only place client code names the auth library. `baseURL` is omitted on
 * purpose: the app is always same-origin with its own route handler. No
 * `useSession` is exported: sessions are read on the server and passed down.
 */
const auth_client = createAuthClient();

export async function sign_in_with_google(callback_url = "/") {
  await auth_client.signIn.social({ provider: "google", callbackURL: callback_url });
}

export async function sign_out() {
  await auth_client.signOut();
}
