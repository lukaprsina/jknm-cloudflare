# TODO

- Image doubling (`both sides < 500px`, see ticket #6): 57 published images have exactly one side under 500px and are not doubled. Look at them and decide whether the rule should change.
- lucide-react dev warning: `(rsc) client component dependency is inconsistently optimized` (`Icon.mjs`, `context.mjs`) plus `[vinext:optimize-imports] skipping "lucide-react": could not resolve specifier "UsersIcon" in barrel export map`. `optimizeDeps.exclude` (top-level and under `environments.rsc`) did not silence it, and renaming imports just moves the unresolved name. Untried: deep imports (`lucide-react/icons/users`). If lucide keeps causing trouble, switch to Phosphor icons.
