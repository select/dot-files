# Visual verification for SPAs and canvases

Use this checklist for charts, structure viewers, and linked selections. Command
options and troubleshooting live in [SKILL.md](../SKILL.md); use the
[flow runner](flows.md) rather than rebuilding its session handling.

## Establish rendering, not just element existence

- Check the actual served response has the regression condition, such as omitted
  metadata fields. Do not inject replacement results to make the test pass.
- Assert displayed counts and labels.
- For a 2D canvas, inspect backing dimensions and pixel variation. A present canvas
  can still be blank:

```javascript
const canvas = document.querySelector('#matrix-canvas');
const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
```

- For WebGL, use a model-loading/readiness signal where available and inspect the
  saved image. Canvas presence and a fixed delay do not prove that a model loaded.
- Software WebGL is useful for local rendering checks, not production-GPU
  performance evidence.

## Exercise both directions of linked selection

Use real pointer events, not direct assignment to component state:

1. Matrix drag → overlay, matching sequence highlights, and 3D coloring.
2. Sequence drag → matching matrix range and 3D coloring.
3. Whole-chain click → selected chain and cleared incompatible range selection.
4. Sample switch → correct new data/counts, cleared old selection.
5. Switch between samples with/without optional data → correct panel visibility.

For custom scripts, measure bounding boxes **after** scrolling/layout settles.
The runner's `drag` action handles this. Pixel-to-chart conversion can produce
fractional values: use tolerances or range membership, not exact integer equality.
Discrete sequence-item selections can use exact integer assertions.

## Vue diagnostics

Prefer DOM assertions and public APIs. `__vueParentComponent` and setup state are
private, version-dependent internals, useful only for development diagnostics.

If a custom `page.evaluate` returns `{}` for a visibly active selection, it may be
serializing a reactive proxy. Return primitive fields or JSON-round-trip compatible
state **inside the page**. The supplied `evaluate.js` and flow `evaluate` action
already do this; no extra workaround is needed there.

## Inspect the evidence

Open the screenshots and verify that:

- The canvas/structure is rendered, not blank or still loading.
- Selection colors agree across views.
- Fixed headers or banners do not obscure the evidence. For full-page capture
  after scrolling, use `--scroll-top` (or `"scroll-top": true` in a flow).

Report what was actually checked, any overrides or expected connection failures,
and untested behavior. In particular, list-to-detail success does not establish
that direct detail links work. Keep reusable flows and verification notes outside
`/tmp` if they must survive a restart.
