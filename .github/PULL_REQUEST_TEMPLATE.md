## What changed

<!-- One paragraph. What the change does and why it is needed. -->

## Which area

- [ ] Runtime (`core/`)
- [ ] Installer / uninstall / manifest
- [ ] Skills
- [ ] Commands
- [ ] Hooks / guard policy
- [ ] Indexer / memory
- [ ] Adapter paths or the compatibility matrix
- [ ] Documentation
- [ ] Tests

## Verification

<!--
Paste the exact commands you ran and their results. "Tests pass" is not enough; if you touched an
adapter, say whether you exercised it against a running agent or only against the documented path.
-->

```sh
$ npm test
```

```sh
$ npm run test:e2e
```

## Checklist

- [ ] `npm test` passes.
- [ ] No new runtime dependency (or the dependency decision is documented in the PR description).
- [ ] Documentation updated where behaviour changed — `README.md`, `docs/compatibility.md`, and
      `docs/architecture.md` are the ones most likely to drift.
- [ ] Adapter changes cite a source and update `core/agents.mjs` together with the matrix.
- [ ] Skill or command changes keep the frontmatter unambiguous (`node core/cli.mjs skills`
      passes with no errors).
- [ ] No credentials, generated artifacts, or local configuration included.
- [ ] Anything not verified is stated as unverified rather than implied to work.
