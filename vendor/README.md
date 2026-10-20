# Reader components

The reader uses Web Awesome 3.14.0’s free card, details and progress-bar
components (MIT), built with Lit (BSD-3-Clause). No Pro components are included.
See the included license files and `components.js.LEGAL.txt` for notices.

Upstream: https://github.com/shoelace-style/webawesome

Rebuild from the repository root with `npm ci --ignore-scripts && npm run build:ui`.
The exact packages are pinned in `package-lock.json`; `manifest.json` records
output hashes. CI checks that rebuilding produces the committed files.
Node is needed to update these assets. Running a course requires only Python.

Only these selected components and the default theme ship. The server and ZIP
export share an explicit asset allowlist in `course_bundle.py`. New dependencies
must include their license notices and remain usable without a CDN connection.
