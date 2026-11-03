import type { ComponentProps } from "react";
import gen_i from "@/assets/gen-i.svg";
import novo_mesto from "@/assets/novo-mesto.svg";
import protectus from "@/assets/protectus.svg";
import { cn } from "@/lib/utils";

const SPONSORS = [
  { image: gen_i, alt: "GEN-I", className: "max-w-40" },
  { image: protectus, alt: "Protectus", className: "max-w-32" },
  { image: novo_mesto, alt: "Mestna občina Novo mesto", className: "max-w-36" },
];

/** The club's sponsors. Plain markup, so it renders in server and client trees alike. */
export function Sponsors({
  compact = false,
  className,
  ...props
}: ComponentProps<"section"> & { compact?: boolean }) {
  return (
    <section
      aria-label="Sponzorji"
      className={cn("rounded-xl border bg-background", compact ? "p-4" : "p-5 md:p-8", className)}
      {...props}
    >
      <div
        className={cn(
          "grid place-items-center gap-3",
          compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-3",
        )}
      >
        {SPONSORS.map(({ image, alt, className }) => (
          <img
            key={alt}
            src={image.src}
            width={image.width}
            height={image.height}
            alt={alt}
            className={cn("h-10 w-auto object-contain sm:h-12", className)}
          />
        ))}
      </div>
    </section>
  );
}
