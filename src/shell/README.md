# CloudLab shell

The shell is the part of CloudLab that does not know which platform it is teaching: the page layout, the canvas
(blocks, arrows, containers, pan / zoom, drag to connect, drag from the library), the inspector drawer, the YAML pane,
the lesson panel (three tiers, resizable), the simulation bar with the cost meter, the event log, full screen, routes,
undo, and the product tour.

A **domain pack** teaches one platform. Two exist:

| Pack | Page | Files |
|---|---|---|
| AWS (CloudFormation) | `/cloudlab/` | `src/aws/*` |
| Kubernetes (manifests) | `/cloudlab/k8s/` | `k8s/src/*` |

All files are classic scripts sharing globals. A page loads, in order:

1. `vendor/js-yaml.min.js`
2. `src/shell/core.js`, `src/shell/model.js`, `src/shell/sim.js`
3. the pack: catalog → model → simulation → lessons → lint / exports → views
4. `src/shell/editor.js`, `src/shell/ui.js`, then optional extras (`src/shell/webmcp.js`, the AWS changelog), then `src/shell/tour.js`

`<meta name="cloudlab-app" content="k8s">` gives a page its own localStorage namespace (`cloudlab:k8s:*`), so each app
keeps its own sandbox, progress and tour flag. The AWS page has no meta and keeps the original `cloudlab:*` keys.

## What a pack must define (globals)

**Catalog**

- `T` (type → definition) and `def(type, spec)`: a definition has `label`, `short` (icon text), `cat` (colour group),
  `doc`, `defaults(id)`, `fields` (inspector), optional `ext` (simulation-only actor), `src` / `sink`, `name(props)`
  (physical name shown under the id), `view(n, rows, cx)` (extra canvas rows / status pill), `container` (draws as a
  box: `box:{pad,head,size}`, `boxLabel(b)`, `boxClass(b)`, `boxEmpty`, `boxExtra(b)`).
- `GROUPS`: `[[cat, "Library group title"], …]` in library order.
- `REL`: edge kind → `{style}` where style is `flow`, `data`, `role` or `grant`.

**Model** (`M` itself is the shell's: `{name, desc, res, ext, manual, pos}`)

- `edges()` → `[{id, from, to, kind, label, owner, path, hidden?, deny?}]`
- `addNode(type, x, y, id?)` → id · `removeNode(id)` · `renameNode(a, b)` → `{ok, err?}` · `removeEdge(e)`
- `connectRule(a, b)` → `{label, apply(grant), grant?}` or `null` · `whyNot(a, b)` → text
- `toYaml()` · `fromYaml(text, keep)` → `{ok, model}` or `{ok:false, err, line?}` · `loadTemplate(yaml, layout, name, manual)`

**Simulation** (the clock, queue and counters are `src/shell/sim.js`)

- `deploy()`, `deleteStack()`, `stackUp()`, `exists(id)`, `syncRuntime()`
- `sources(t0, dt)`, `handle(ev, t1)`, `periodic(t0, dt)`, `fire(node, count, at)`
- helpers it can use: `nrt(id)`, `bump(id, key, w)`, `charge(id, usd, what)`, `flow(a, b, kind, w, err?)`, `push(ev)`,
  `probe(fn)` (run on a throw-away copy, for lesson checks)
- `RT.stack.status` uses the shell's lifecycle names: `NOT_DEPLOYED`, `CREATE_COMPLETE`, `UPDATE_COMPLETE`,
  `DELETE_COMPLETE` (+ any the pack adds); `DOMAIN.texts.status` says how each is shown.

**Lessons and the rest**

- `LESSONS` (see `src/aws/lessons.js` for the shape: `id, step, phase, title, tag, who, scenario, goal, concepts,
  yaml, layout, explain, tasks:[{t, c, test}], hints(), diagnose(i), solve(), pass, bank?`), `STARTER`, `STARTERS`
- `problems()` → `[{sev: "error"|"warn"|"info", id, msg}]`
- `EXPORTS`: tab → `{label, file, edit?, gen?, note?, aria?}` (the editable tab is the pack's own YAML)

## DOMAIN (hooks and texts)

`DOMAIN.texts` holds every string that names the platform (stack vs cluster, Deploy vs kubectl apply, the CLI name, the
sandbox intro, import help, tour texts). `TX(key, …args)` reads one; a function value is called with the args.

`DOMAIN.fields[type] = {html(node, field, c), read(fieldset), write?(node, key, value, fieldset)}` adds inspector field
types beyond `text`, `number` and `select`.

`DOMAIN.actions[name] = (arg, el, event) => …` handles `data-act="name"` buttons the pack renders (return `true` to skip
the re-render).

Optional hooks: `view(n, rows, cx)` · `rt(n, {r, m, p})` (runtime panel HTML) · `nodeActs(n)` (buttons) ·
`edgeState(e, flow, st, from)` · `parentOf(n)` (container id) · `dropHint`, `onDrop`, `dragHint`, `onDragEnd`
(placement in containers) · `beforeDelete(n)` (return `false` to stop) · `afterDelete(n)` · `onChange(el)` ·
`redeploy(label, cli)` (an edit while deployed) · `runtime()` (extra `RT` fields) · `onNewMonth()` ·
`manualStatus(n)` · `lessonRef(L)` · `eli5(type)` · `fmt(value)` · `idValue(n)` (what the name field shows; `renameNode` may return `{ok, id}` with the new id) · `relDoc` · `keepNull` · `api` (added to
`window.CloudLab`).

`DOMAIN.mcp` feeds `src/shell/webmcp.js` (the 16 browser-agent tools and the ✦ dialog): `d` (tool and parameter
descriptions keyed `tool` or `tool.param`, e.g. `load_template.yaml`), `guide()` (what `get_format_guide` returns),
`guideHref` (the page's `learn.html#gemini`), `artifact` (“template” / “manifest”), `unitRes`, and
`setProp(raw, path, value)` (return `true` when it handled a path itself; otherwise the path is set under `Properties`).
`export_iac` offers the keys of `EXPORTS`.

## Text versions

`tools/export-text.js` (AWS: `llms.txt`, `llms-full.txt`, `learn.html`, `credits.html`) and `tools/export-k8s.js`
(`k8s/llms.txt`, `k8s/llms-full.txt`, `k8s/learn.html`) load the pack in Node and write the lessons, the component
explanations and the Gemini guide as plain files. `build.py` runs both.
