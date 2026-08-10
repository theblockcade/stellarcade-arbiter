# Contributing to stellarcade-arbiter

Thanks for your interest in contributing! Please read these rules before you
start — pull requests that don't follow them will be closed.

## The rules

1. **Fork the repo and work from your fork.**

   ```sh
   gh repo fork TheBlockCade/stellarcade-arbiter --clone
   cd stellarcade-arbiter
   git checkout -b my-change
   git push -u origin my-change
   ```

2. **All pull requests target `main`.**

3. **Contributor changes must stay inside `contrib/`** unless the change is a
   bug fix with a linked issue. See [contrib/README.md](contrib/README.md). If
   you need to touch code elsewhere, open an issue first and confirm scope.

4. **Changes to `src/entropy.ts`, `src/beacon.ts`, `src/settle.ts`,
   `src/policy.ts`, or `migrations/` need extra scrutiny** — this is the code
   that decides who gets paid what. Explain the reasoning in your PR
   description, not just the diff.

## Before you open a PR

```sh
npm install
npm run typecheck
npm test
npm run build
```

New code is expected to come with tests, including a failure-path test, not
just the happy path — this is a settlement service, so "it works when
everything goes right" isn't the interesting case.
