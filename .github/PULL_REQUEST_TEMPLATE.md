## Why

<!-- What problem this solves. Not what you changed; why it needed changing. -->

## How it works

<!-- Functionally, how the change behaves. Reviewers read this before the diff. -->

## Validation

- [ ] `npm run gate` green (typecheck, tests, build)
- [ ] New behaviour has tests
- [ ] Bug fixes have a test that **failed before the fix** (see docs/quality.md)
- [ ] Any invariant change moved its guard test in the same commit
- [ ] Docs updated where they went stale

### Balance

Delete this section if the change cannot move game feel. Otherwise paste
`npm run sim -- sweep --seeds 6 --minutes 4` from before and after, and compare the
envelope across seeds rather than a single seed.

```
before:
after:
```
