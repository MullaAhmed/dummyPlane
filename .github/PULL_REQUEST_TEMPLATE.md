## What changed

<!-- A short summary of the change. -->

## Why

<!-- The problem it solves. Link the issue: "Fixes #123". -->

## How it was tested

<!-- The tests you added, and what you checked in the app. Screenshots or a short GIF help for anything visible. -->

## Checklist

- [ ] Tests come with the change, and I saw the new ones fail before the fix.
- [ ] `pnpm exec tsc --noEmit`, `pnpm test` and `pnpm build` pass.
- [ ] `cargo test`, `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check` pass (in `src-tauri`).
- [ ] New interface text is in English, and so are code, comments and commits.
- [ ] I tried the change in the development build, with its own data folder.
