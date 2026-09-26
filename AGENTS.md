# Agent rules (Codex, Claude Code, or any other coding agent)

- Code only. Never commit secrets, `.env` files, or research/vault content.
- Never touch `main` directly. Work on a branch named `<your-github-username>/<topic>`.
- Open a pull request for every change. Small PRs, fast review.
- No force-push.
- Run the existing test suite before opening a PR (if tests exist for what you touched).
- Don't add a new dependency without saying why in the PR description.
- Commit as the human who owns the session — no `Co-Authored-By` or "Generated with" lines, no AI tool names in commit messages or authorship.
- Write commit messages, PR descriptions, and code comments in plain, simple language. Short sentences. No jargon, no clever wording. Say what changed and why, nothing fancier.
- One person owns one feature at a time. Don't edit files another teammate's branch is actively working on — ask in Discord first if you need to touch shared code.
- This repo has no direct access to the team's shared research (the Obsidian vault). If you need project context, notes, or research, ask in Discord — Axiom (the team bot) answers from the vault. Don't try to read, copy, or guess vault content.
