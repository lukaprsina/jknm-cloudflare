import { NotFoundContent } from "@/components/not-found-content";

/**
 * Only for URLs that match no route (such as `/a/b/c`). Single segments reach
 * the site shell's own `not-found.tsx`; the shell is not repeated here.
 */
export default function RootNotFound() {
  return (
    <main>
      <NotFoundContent />
    </main>
  );
}
