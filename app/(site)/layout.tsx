import { SiteFooter } from "@/components/shell/site-footer";
import { SiteHeader } from "@/components/shell/site-header";

/**
 * The public shell. ADR-0001: nothing here may read the session, or every public
 * page stops being cacheable. Routes that are not public (`/prijava`, the editor)
 * live outside this group.
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
      >
        Preskoči na vsebino
      </a>
      <SiteHeader />
      <main id="main" className="pb-10">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
