# Offline reader components

The reader uses actual shadcn/ui source pinned in `ui/components/source.json`, built on Radix. Typography uses the self-hosted Geist Variable font. Lucide supplies icons. All browser dependencies are bundled locally.

Run `bun install --frozen-lockfile && bun run build:ui`. Commit `vendor/` and the generated root browser scripts together. `bun run import:ui` reimports the pinned upstream components with the documented utility prefix adaptation; it is not needed for normal builds.

`manifest.json` records versions, provenance and output hashes. `THIRD-PARTY-LICENSES.txt` contains complete shipped licenses, including shadcn MIT and Geist OFL. No CDN is required to read or share a course.
