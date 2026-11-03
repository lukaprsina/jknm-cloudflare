import type { ComponentProps } from "react";
import logo from "@/assets/logo-barvni.svg";
import { CLUB_NAME } from "@/lib/club";

/** The club logo: shield and wordmark. */
export function Logo(props: Omit<ComponentProps<"img">, "src" | "alt">) {
  return <img src={logo.src} width={logo.width} height={logo.height} alt={CLUB_NAME} {...props} />;
}
