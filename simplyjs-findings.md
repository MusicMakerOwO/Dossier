# SimplyJS findings

Walls Dossier hits in SimplyJS, kept here rather than worked around silently. Dossier is the
library's pre-beta stress test, so a finding is a deliverable, not a bug to route around.

## What counts

- **Behaviour contradicts the types or docs:** a union branch the handler can never emit, or a
  comment the code does not follow.
- **Something Dossier needs is missing from the public surface:** a field Discord sends that the
  library drops, or context a structure should carry.
- **A library convention is broken:** a stray snake_case property on a non-payload type, or the same
  question answered three different ways across similar structures.
- **An ergonomics papercut that every consumer would re-solve,** even when Dossier has a workaround.

Out of scope: anything not visible in `node_modules/simplyjs/dist/index.d.ts` or the bundled source,
and guesses about library internals. If the public types don't say, the finding is that they don't say.

## How to write one

Add a numbered `## N. Title` section that states the problem, then cover:

1. **Found:** what Dossier was building when it hit the wall, with the file.
2. **Evidence:** the relevant declaration or handler, quoted, with `index.d.ts` / `index.js` line
   references and the library version.
3. **What would fix it:** the smallest change that would, plus any design caveat.
4. **Dossier's position:** the workaround and where it lives, or that the work is blocked. Point the
   workaround's code comment back here (`simplyjs-findings.md, finding N`) so it gets removed once
   the fix lands.

When a release fixes a finding, verify it against the declarations and the handler source, migrate
Dossier off the workaround, then remove the entry.

---

No open findings. Numbering continues from 18, so resolved numbers in history stay unambiguous.
