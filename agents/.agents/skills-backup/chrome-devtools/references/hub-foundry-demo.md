# Hub / Foundry demo verification

Read the checkout's `ui/AGENTS.md` first. This recipe reflects EN-6535; verify demo
IDs and artifact mappings in `ui/public/demo/foundry-runs.json` if it changes.

## Run the supplied flow

Check whether port 8081 is already serving the intended checkout. Start
`cd ui && pnpm dev` only if needed; otherwise Nuxt may silently choose another port.
Then run from the **Hub project root**:

```bash
node ~/.pi/agent/skills/chrome-devtools/scripts/run.js \
  --flow ~/.pi/agent/skills/chrome-devtools/scripts/examples/hub-foundry-selection.json \
  --allow-overrides --clear-storage --software-webgl \
  --timeout 60000 --output-dir "$PWD/docs/screenshots"
```

The flow verifies CIF-derived chain counts, omission of metadata count maps, and
matrix-to-chain/chain-to-matrix selection. It saves initial, matrix-selection, and
chain-selection screenshots. Inspect their actual Mol* rendering using the
[visual checklist](spa-visual-verification.md).

## Demo-specific behavior

- Entry URLs need `?demo&agree-tou`; stale local storage can override demo mode.
- Demo mode does **not** enable Foundry. Without `FOUNDRY_ENABLED` from
  `/config.json`, `/foundry` can redirect to `/`.
- The supplied flow overrides only `/config.json` to enable Foundry and disable
  auth for local testing. It leaves metadata/CIF requests untouched. Prefer real
  backend configuration when available and remove the override from a copied flow.
- Without the backend socket, an offline banner and connection errors are expected.
  This is UI verification, not backend validation.
- Navigate through the listing: a fresh demo detail page may lack the run collection
  populated there. Preserve query flags when navigating.

## Expected data and additional checks

| Sample | Metadata source | Expected |
| --- | --- | --- |
| `mcl1_lig2` | `/demo/output/job_0JwhEC9Qa/meta/mcl1_lig2_sample_1.json` | 170×170 PDE matrix |
| `mcl1_lig1` | `/demo/output/job_noPDE_test1/meta/mcl1_lig1_sample_1.json` | No PDE panel |

Both omit `atoms_in_chain` and `residues_in_chain`. Chain A has 158 polymer residues;
chain Z has 12 ligand atoms. Without input request data, the sequence may display
inferred `X` placeholders—this verifies counts, not original amino-acid letters.

Beyond the supplied flow, test clicking chain Z (highlight ligand, fade other
chains, clear matrix range), and switching samples (reset selection, hide/restore
PDE). Useful selectors:

- Chain buttons: `[data-test="foundry-chain"]`
- Sample rows: `[data-test="foundry-stats-table"] button`
- Matrix panel/selection: `[data-test="foundry-matrix-panel"]`, `[data-test="matrix-selection"]`
- Errors: `[data-test="foundry-chain-counts-error"]`, `[data-test="molstar-viewer-error"]`
