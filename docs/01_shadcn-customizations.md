# shadcn/ui customizations in the old jknm repo

Which files in `src/components/ui` of `/home/luka/code/js/jknm` differ from what shadcn generated, based on git history.

## Method and caveats

- For each file, the oldest commit that added it was found with `git log --follow --diff-filter=A`. That version was compared with HEAD using `git diff --no-index` on copies in `/tmp`, with and without `-w`.
- Because the originals use tabs and mixed semicolons, plain diffs are noisy (Biome reformatted everything on 2026-07-09, commit `202fb58`). Both sides were then run through the same Prettier config (tabs, no project config) before diffing. Remaining noise is import/export sorting and Biome lint autofixes (`import type`, `biome-ignore` comments), which are treated as FORMAT-ONLY.
- Classes: UNTOUCHED (byte-identical), FORMAT-ONLY (formatting, import/export order, lint autofix with no behavior change), CUSTOMIZED (real class, prop or behavior change).
- The repo history starts in 2022, but the shadcn install is not from 2022. 35 of the 39 files were added together in `f3e4852` (2024-09-03, "added shadcn components"), a mixed commit that also touched `package.json`, `tailwind.config.ts` and `src/hooks/use-toast.ts`. The files in that commit already use the `~/` alias and the "default" style, so no alias migration happened afterwards. It looks like a real install, but whether it was pristine cannot be proven from git.
- Files added later were single-component installs, and their first-add version is the baseline. These are suspicious only in the sense that they may include edits from the start: `alert` (2024-09-27), `textarea` (2025-02-12), `empty` (2026-07-22), `collapsible` (2026-08-11), `button-group` (2026-08-14), `avatar` (2026-08-16), `multi-select` (2026-08-24). `button-group` and `empty` use the newer shadcn style (`data-slot` attributes), so they come from a newer shadcn registry than the rest.
- Files deleted over time and absent at HEAD: `calendar.tsx`, `carousel-thumbnails.tsx`, `sheet.old.tsx`.

Counts: 39 files. UNTOUCHED 1, FORMAT-ONLY 32, CUSTOMIZED 6.

## Summary table

| File                | First add (commit, date) | Class       | Summary                                                                                               |
| ------------------- | ------------------------ | ----------- | ----------------------------------------------------------------------------------------------------- |
| accordion.tsx       | f3e4852 2024-09-03       | FORMAT-ONLY | Formatting, import/export order, lint fixes only                                                      |
| alert-dialog.tsx    | f3e4852 2024-09-03       | FORMAT-ONLY | Formatting, import/export order, lint fixes only                                                      |
| alert.tsx           | 512f2d9 2024-09-27       | FORMAT-ONLY | Import and export order only                                                                          |
| aspect-ratio.tsx    | f3e4852 2024-09-03       | FORMAT-ONLY | Semicolons only                                                                                       |
| avatar.tsx          | 8fac5b7 2026-08-16       | FORMAT-ONLY | Export order only; added 2026                                                                         |
| badge.tsx           | f3e4852 2024-09-03       | FORMAT-ONLY | import type React (lint)                                                                              |
| breadcrumb.tsx      | f3e4852 2024-09-03       | CUSTOMIZED  | Added tabIndex={-1} to BreadcrumbPage (lint-driven, trivial)                                          |
| button-group.tsx    | 699e40d 2026-08-14       | FORMAT-ONLY | Added biome-ignore comment only; added after biome adoption                                           |
| button.tsx          | f3e4852 2024-09-03       | FORMAT-ONLY | Formatting, import/export order, lint fixes only                                                      |
| card.tsx            | f3e4852 2024-09-03       | FORMAT-ONLY | Formatting, import/export order, lint fixes only                                                      |
| carousel.tsx        | f3e4852 2024-09-03       | CUSTOMIZED  | Removed arrow-key handler and axis-based orientation fallback; initial state sync moved out of effect |
| checkbox.tsx        | f3e4852 2024-09-03       | FORMAT-ONLY | Formatting, import/export order, lint fixes only                                                      |
| collapsible.tsx     | 663f544 2026-08-11       | FORMAT-ONLY | Export order only; added 2026                                                                         |
| command.tsx         | f3e4852 2024-09-03       | CUSTOMIZED  | Restyled group headings and items, added commandProps to CommandDialog                                |
| context-menu.tsx    | f3e4852 2024-09-03       | FORMAT-ONLY | Formatting, import/export order, lint fixes only                                                      |
| dialog.tsx          | f3e4852 2024-09-03       | FORMAT-ONLY | Formatting, import/export order, lint fixes only                                                      |
| drawer.tsx          | f3e4852 2024-09-03       | FORMAT-ONLY | Formatting, import/export order, lint fixes only                                                      |
| dropdown-menu.tsx   | f3e4852 2024-09-03       | FORMAT-ONLY | Formatting, import/export order, lint fixes only                                                      |
| empty.tsx           | 3f10b9c 2026-07-22       | FORMAT-ONLY | Export order only; added 2026                                                                         |
| form.tsx            | f3e4852 2024-09-03       | FORMAT-ONLY | Formatting, import/export order, lint fixes only                                                      |
| hover-card.tsx      | f3e4852 2024-09-03       | FORMAT-ONLY | Formatting, import/export order, lint fixes only                                                      |
| input.tsx           | f3e4852 2024-09-03       | FORMAT-ONLY | Interface changed to type alias (lint)                                                                |
| label.tsx           | f3e4852 2024-09-03       | FORMAT-ONLY | Formatting, import/export order, lint fixes only                                                      |
| multi-select.tsx    | 7c3c73e 2026-08-24       | UNTOUCHED   | Not shadcn (third-party sersavan component); identical to first add                                   |
| navigation-menu.tsx | f3e4852 2024-09-03       | CUSTOMIZED  | Chevron removed, new active/viewport styles, hardcoded viewport width                                 |
| pagination.tsx      | f3e4852 2024-09-03       | FORMAT-ONLY | Dropped redundant role=navigation (no behavior change)                                                |
| popover.tsx         | f3e4852 2024-09-03       | FORMAT-ONLY | Formatting, import/export order, lint fixes only                                                      |
| scroll-area.tsx     | f3e4852 2024-09-03       | FORMAT-ONLY | Formatting, import/export order, lint fixes only                                                      |
| select.tsx          | f3e4852 2024-09-03       | FORMAT-ONLY | Formatting, import/export order, lint fixes only                                                      |
| separator.tsx       | f3e4852 2024-09-03       | FORMAT-ONLY | Formatting, import/export order, lint fixes only                                                      |
| sheet.tsx           | f3e4852 2024-09-03       | CUSTOMIZED  | Added container prop for custom portal target                                                         |
| skeleton.tsx        | f3e4852 2024-09-03       | FORMAT-ONLY | No code changes beyond formatting                                                                     |
| switch.tsx          | f3e4852 2024-09-03       | FORMAT-ONLY | Formatting, import/export order, lint fixes only                                                      |
| table.tsx           | f3e4852 2024-09-03       | CUSTOMIZED  | Added dense/article variants for TableHead and TableCell, removed row hover, footer opacity           |
| tabs.tsx            | f3e4852 2024-09-03       | FORMAT-ONLY | Formatting, import/export order, lint fixes only                                                      |
| textarea.tsx        | eee7e53 2025-02-12       | FORMAT-ONLY | No code changes beyond formatting                                                                     |
| toast.tsx           | f3e4852 2024-09-03       | FORMAT-ONLY | Formatting, import/export order, lint fixes only                                                      |
| toaster.tsx         | f3e4852 2024-09-03       | FORMAT-ONLY | Map callback rewritten as arrow function, same output                                                 |
| tooltip.tsx         | f3e4852 2024-09-03       | FORMAT-ONLY | Formatting, import/export order, lint fixes only                                                      |

## Customized components

Diffs are original (first add) vs HEAD, after Prettier normalization, with import and export reordering omitted.

### breadcrumb.tsx

- Minor, lint-driven: `tabIndex={-1}` added to `BreadcrumbPage` along with a `biome-ignore` comment.
- Later commits: `3ab124b` a lot of eslint and biome fixes; `202fb58` biome.

```diff
 	<span
 		ref={ref}
 		role="link"
+		tabIndex={-1}
 		aria-disabled="true"
```

### carousel.tsx

- Arrow-key navigation (`onKeyDownCapture` handler) removed.
- Orientation no longer falls back to `opts.axis === "y"`; it is just `orientation` (default from the props). Check that no caller relies on the axis fallback.
- Initial scroll-button state is synced during render (`previousApi` pattern) instead of inside the effect, to satisfy the react-hooks lint.
- Later commits: `3ab124b` a lot of eslint and biome fixes; `9532e36` Rewrite image gallery: fix scroll-lock, landscape crop, caption alignment (#28); `202fb58` biome; `dca3ad9` compiles, starting image crop gallery.

```diff
+		const [previousApi, setPreviousApi] = React.useState(api);
+		if (api && api !== previousApi) {
+			setPreviousApi(api);
+			onSelect(api);
+		}
...
-		const handleKeyDown = React.useCallback(
-			(event: React.KeyboardEvent<HTMLDivElement>) => {
-				if (event.key === "ArrowLeft") { ... scrollPrev(); }
-				else if (event.key === "ArrowRight") { ... scrollNext(); }
-			}, [scrollPrev, scrollNext]);
...
-			onSelect(api);
 			api.on("reInit", onSelect);
...
-					orientation:
-						orientation || (opts?.axis === "y" ? "vertical" : "horizontal"),
+					orientation: orientation,
...
-					onKeyDownCapture={handleKeyDown}
```

### command.tsx

- Group headings restyled: bordered, uppercase, bold, tracking-wider, `text-foreground/80` instead of muted.
- `CommandItem` gets `gap-2` and svg sizing classes (`[&_svg]:size-4`), as in newer shadcn.
- `CommandDialog` accepts a `commandProps` prop passed to the inner `Command`.
- Later commits: `5dd3a77` style: update footer and command (!) style; `202fb58` biome; `ba10266` cant build; `887dfc1` compiles, algolia 4.

```diff
-interface CommandDialogProps extends DialogProps {}
+interface CommandDialogProps extends DialogProps {
+	commandProps?: React.ComponentPropsWithoutRef<typeof CommandPrimitive>;
+}
-const CommandDialog = ({ children, ...props }: CommandDialogProps) => {
+const CommandDialog = ({ children, commandProps, ...props }: CommandDialogProps) => {
...
-				<Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground ...">
+				<Command
+					{...commandProps}
+					className="[&_[cmdk-group-heading]]:border-b [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-1.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-foreground/80 ..."
+				>
...
 CommandGroup:
-	"overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
+	"overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:border-b [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-1.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-foreground/80",
 CommandItem:
-	"relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none ..."
+	"relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none ... [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
```

### navigation-menu.tsx

- Trigger chevron removed (commented out, plus a commented-out onClick block).
- Trigger style: `data-[active]` and `data-[state=open]` now use full `bg-accent` instead of `bg-accent/50`.
- Viewport wrapper gets `w-full`; viewport width is a hardcoded `w-[653.16px]` and the `md:w-[var(--radix-navigation-menu-viewport-width)]` responsive width is gone. Height uses the Tailwind 4 syntax `h-(--radix-...)`.
- Later commits: `7c3c73e` feat: update MagicCard gradient color and opacity; add MultiSelect component; enhance NavigationMenu styles...; `a7b0ee8` navbar works; `202fb58` biome; `c3a4916` initial; `41e7aee` navmenu graphic, window.scrollY force throttle.

```diff
-import { ChevronDown } from "lucide-react";
+// import { ChevronDown } from "lucide-react";
...
-...data-[active]:bg-accent/50 data-[state=open]:bg-accent/50",
+...data-[active]:bg-accent data-[state=open]:bg-accent",
...
-		{children}{" "}
-		<ChevronDown className="relative top-[1px] ml-1 h-3 w-3 transition duration-200 group-data-[state=open]:rotate-180" aria-hidden="true" />
+		{children}
+		{/* <ChevronDown ... /> */}
...
-	<div className={cn("absolute left-0 top-full flex justify-center")}>
+	<div className={cn("absolute left-0 top-full flex w-full justify-center")}>
...
-"origin-top-center relative mt-1.5 h-[var(--radix-navigation-menu-viewport-height)] w-full overflow-hidden ... data-[state=open]:zoom-in-90 md:w-[var(--radix-navigation-menu-viewport-width)]",
+"origin-top-center relative mt-1.5 h-(--radix-navigation-menu-viewport-height) w-[653.16px] overflow-hidden ... data-[state=open]:zoom-in-90",
```

### sheet.tsx

- `SheetContent` gets a `container` prop forwarded to `SheetPortal`, so the sheet can render inside a specific element.
- Later commits: `202fb58` biome; `c3a4916` initial; `a8031cb` navbar, gallery improved; `30aae09` testing article.

```diff
 interface SheetContentProps
 	extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
-		VariantProps<typeof sheetVariants> {}
+		VariantProps<typeof sheetVariants> {
+	container?: Element;
+}
-	>(({ side = "right", className, children, ...props }, ref) => (
-	<SheetPortal>
+	>(({ side = "right", container, className, children, ...props }, ref) => (
+	<SheetPortal container={container}>
```

### table.tsx

- New `tableHeadVariants` and `tableCellVariants` (cva) with a `variant` prop: `default` (original shadcn look), `dense` (admin data) and `article` (bordered cells, muted header background, for prose tables).
- `TableRow` loses `hover:bg-muted/50`; `TableFooter` uses `bg-muted` instead of `bg-muted/50`.
- Later commits: `71f76b6` feat: add editorjs-table submodule; update ContactForm and ContactPage styles; enhance table component styling; `9144e32` refactor: remove unused header component...; `be0a850` feat: add cache invalidation documentation...; `202fb58` biome; `6fb08a5` authors table pagination.

```diff
+const tableHeadVariants = cva(
+	"align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0",
+	{ variants: { variant: {
+		default: "h-12 px-4 text-left",
+		dense: "h-auto py-[1px] px-2 text-left",
+		article: "h-auto border py-[1px] px-2 text-left bg-muted",
+	} }, defaultVariants: { variant: "default" } },
+);
+const tableCellVariants = cva("align-middle [&:has([role=checkbox])]:pr-0", {
+	variants: { variant: {
+		default: "p-4",
+		dense: "py-[1px] px-2",
+		article: "border py-[1px] px-2",
+	} }, defaultVariants: { variant: "default" },
+});
...
-	"border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
+	"border-t bg-muted font-medium [&>tr]:last:border-b-0",
-	"border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
+	"border-b transition-colors data-[state=selected]:bg-muted",
 TableHead / TableCell:
-	className={cn("h-12 px-4 text-left align-middle ...", className)}
+	className={cn(tableHeadVariants({ variant }), className)}
```

## Not shadcn

- `multi-select.tsx`: third-party component from https://github.com/sersavan/shadcn-multi-select-component (header comment says vendored at `vendor/shadcn-multi-select-component`). Added 2026-08-24 in `7c3c73e` and unchanged since. It builds on shadcn `Badge`, `Button`, `Command`, `Popover` and `Separator`.

No other non-shadcn files exist in `src/components/ui`. `use-toast` is in `src/hooks/use-toast.ts`, not in this directory. `button-group.tsx` and `empty.tsx` are shadcn components from the newer registry. `toaster.tsx` is the standard shadcn toast companion.
