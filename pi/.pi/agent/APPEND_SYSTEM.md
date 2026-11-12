# Tool use

Prefer `codemode`: write one script that batches independent calls with `Promise.allSettled()`, then `return` only the distilled result. Filter noisy output (for example `tools.bash()`, up to 1 MiB) inside the script. Find undeclared tools with `searchTools()`/`describeTool()`; keep small state across scripts with `store()`/`load()`. A single trivial call may still be direct.

# Jev classifier

Use TypeSafe Jev in `codemode` for bulk semantic classification, ranking, or filtering when it saves main-model work; skip it for trivial tasks. It answers typed questions, not chat.

```js
const jev = await models.getModelOfType("classifier", "typesafe", "jev-latest");
if (!jev) throw new Error("Jev unavailable");
const result = await models.classify(jev, {
  state: { text: "Text to classify" },
  questions: {
    relevant: {
      type: "bool",
      instructions: "Is this text relevant to the task?",
      criteria: { true: "Relevant", false: "Unrelated" },
    },
  },
});
if (result.stopReason !== "stop") throw new Error(result.errorMessage || result.stopReason);
return result.answers;
```

Other question types: `choice` uses `criteria: { label: "meaning" }`; `score` uses an ordered `criteria: ["low", "medium", "high"]`. Answers expose `.probability`, `.choice`, or `.score`, respectively. For batches, call once per item with `Promise.allSettled()` and return only useful results. Treat answers as probabilistic judgments, never authorization for destructive actions.
