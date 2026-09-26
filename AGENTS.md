# Agent rules (Codex, Claude Code, or any other coding agent)

- Code only. Never commit secrets, `.env` files, or research/vault content.
- Never touch `main` directly. Work on a branch named `<your-github-username>/<topic>`.
- Open a pull request for every change. Small PRs, fast review.
- No force-push.
- Run the existing test suite before opening a PR (if tests exist for what you touched).
- Don't add a new dependency without saying why in the PR description.
- Commit as the human who owns the session — no `Co-Authored-By` or "Generated with" lines, no AI tool names in commit messages or authorship.
