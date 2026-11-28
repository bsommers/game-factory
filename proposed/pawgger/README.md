# Pawgger proposals: how to review and adopt

Nothing here is live. Every change is staged; the factory tree differs from its git HEAD only by `proposed/`
(`git -C <factory> status --short` shows just `?? proposed/`). The index table at the top of `CHANGELOG-PAWGGER.md`
lists every entry with its target path; `LEARNINGS-PAWGGER.md` has the lessons.

Run all commands from the factory root (`F=../game-factory`, `P=$F/proposed/pawgger`).

## Modified files (`*.proposed`)
Unified diffs, `/` in the path becomes `_`. Review, then apply:

    diff -u bin/factory-scaffold.sh $P/bin_factory-scaffold.sh.proposed | head   # the files are diffs: read them directly
    patch -p1 --dry-run < $P/tools_web_pkg_build-web.mjs.proposed && patch -p1 < $P/tools_web_pkg_build-web.mjs.proposed
    patch -p1 < $P/tools_web_shot.mjs.proposed
    (cd tools/web && patch -p2 < $P/tools_sheet.mjs.proposed)     # written against the template path tools/sheet.mjs
    # ship-showcase patches: see its changelog entry (rename, then patch -p1)

## New files (`new/`)
`new/<path>` goes to `<factory>/<path>` unchanged:

    cp -rn $P/new/src/lib/. templates/web-project/src/lib/        # grid-hop, grid-hop-autopilot
    mkdir -p templates/web-project/test/lib && cp -n $P/new/test/lib/grid-hop*.mjs templates/web-project/test/lib/
    cp -rn $P/new/src/kits/. templates/web-project/src/kits/      # painter-kit, toon-kit, pixctx-kit, library-sprites, audio-kit/live-music.js
    cp -rn $P/new/styles/presets/. styles/presets/ && cp -n $P/new/skills/ship-showcase.md skills/ && cp -n $P/new/docs/SHIP-SHOWCASE.md docs/
    cp -rn $P/new/templates/web-project/. templates/web-project/ && cp -n $P/new/tools/extract-sheet-characters.mjs tools/web/

Then regenerate the skill index (`node factory-core/guide/cli.mjs index`), add the style rows listed in the changelog to
`docs/STYLES.md`, and run `node --test test/` (the factory's own suite; it must stay green).

## Verify before adopting
`node --test $P/new/test/lib/*.test.mjs` needs a `package.json` with `"type":"module"` above the files (use a scratch dir).
Pawgger's `test/factory-sop.test.mjs` and `test/factory-extract.test.mjs` re-check the staged files.
