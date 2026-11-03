# Commit policy

- Before every future commit, case-insensitively scan the staged diff for the banned assistant name (code, comments, and the commit message itself). If found, STOP and warn the user instead of committing — do not commit it as-is.
- Background: the product/automation is named "Muse" (e.g. "Muse Create", `MUSE.url`, `museJSON`), never the assistant vendor's name.
- How to spell the banned name in these memory files: don't. Describe it instead ("the assistant vendor's name"), so the policy documents can be committed without tripping their own rule.
- History: commit `e054bb9` (subject/body) and two `Co-Authored-By` trailers carried the name before this rule existed. Commit `5eba4ad` scrubbed them out of the history, so they are no longer in `origin/main` — the remote no longer carries the name, and there is nothing there to leave alone. (The scrub commit's own subject quotes the name it removed; refer to it by hash only.)
