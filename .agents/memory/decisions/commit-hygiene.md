# Commit hygiene

- Never commit any mention of the assistant vendor's name (case-insensitive) in code, comments, or commit messages without asking Dan first. This covers prose, `Co-Authored-By` trailers, and tool names in new text.
- Enforcement is local to this clone: `.git/hooks/pre-commit` blocks staged added lines mentioning it, `.git/hooks/commit-msg` blocks the message. Both print the offending lines; intentional mentions go through with `git commit --no-verify`.
- This file and `../commit-policy.md` state the rule without spelling the name, so both can be committed as-is.
- History: the old commit `e054bb9` and its two `Co-Authored-By` trailers were scrubbed by `5eba4ad`; the remote no longer carries them.
- The one remaining occurrence in the tree was a `docs/product/journal.md` line about a blocked secret-store write. It has been rewritten to drop the name, so the repo is clean and the rule can be enforced without an exception.
