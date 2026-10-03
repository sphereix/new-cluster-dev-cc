# clustercloudv3

build from this project C:\Users\sphereix\jarvis-dev\worktrees\clustercloud-third-skills-20261002_031859-build

use the same block clusters, and keep the site design the same but just make it clustercloud.uk orange

## Status

Built — static site, no build step, no dependencies. Same section content and
block clusters as the source project, restyled in clustercloud.uk orange
(#f97316 primary, #ea580c deep, #ffedd5 tint) on a warm near-black ground.

The source project drove its 3D hero with React Three Fiber plus a
postprocessing stack. This port drops the framework and reimplements the same
cluster in raw WebGL — one instanced draw call for the rack fleet, one
`gl.LINES` draw for the whole network graph, and point clouds for the volume,
dust, stars and edge endpoints. The GLSL is the source project's, ported with
the same uniforms (`uHighlight`, `uExpand`, `uBaseOpacity`, `uPulseGain`, …)
so the scroll story behaves identically.

## Layout

```
clustercloudv3/
  README.md          this file
  .gitignore

  index.html        the page
  styles.css        its styling
  app.js            its script
  tools/verify.py   structural check (see below)
```

## Usage

Open `index.html` in a browser. No build step, no dependencies, no server.

The 3D stage needs WebGL2; if that is unavailable it falls back to WebGL1 via
`ANGLE_instanced_arrays`, and if there is no WebGL at all the page sets
`body.no-webgl` and renders a static gradient instead. Everything else — nav,
scroll reveals, progress rail, contact form validation — is plain DOM and works
regardless.

## Verify

```
python tools/verify.py
```

Checks that `index.html` tags are balanced, that `styles.css` and `app.js`
braces balance, and that every id, anchor target and JS-toggled class the
script depends on actually exists. Exits non-zero on any mismatch.
