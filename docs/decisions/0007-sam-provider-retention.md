# 0007 — SAM provider retention: promise only what our Worker does

Date: 2026-11-02. Status: accepted (Dan, in session). Answers SAM spec Q7
as far as it can be answered today; the provider-side half stays open.

## What we know (verified in code)

- Our Worker (`worker/meta.ts`, `worker/roomScan.ts`) forwards the photo
  to the Meta Model API (`sam-3.1`) and keeps nothing: no image in
  storage, logs, or analytics. Logs carry event names, counts, and
  statuses only. Responses to the client are boxes, mask summaries,
  or counts — never the photo back.
- The client downscales before upload (`downscalePhoto`, 512 px edge)
  and holds the photo only in page memory for the scan flow.
- The Responses API reply observed in the 2026-11-02 Spark vision
  spike carries `"store": true` in its response envelope. What the
  provider retains server-side, for how long, and whether inputs are
  used for training is governed by the Meta API terms for this
  account, which have **not** yet been read and recorded here.

## Decision

Until the provider terms (or an account-level no-retention/no-training
setting) are read and pasted into this file:

1. Kid/parent-facing copy promises only our side, verbatim pattern:
   "Photos are checked and deleted. We only keep the count." — never
   "nobody sees your photo" or any claim about the provider.
2. Feature 6 keeps its stricter local rule regardless: counts and
   coarse boxes only, no silhouette, no background pixels stored.
3. Any future copy that mentions the provider must cite the recorded
   terms below; marketing claims about privacy wait for that record.

## Still to record (owner: Dan, before any public privacy claim)

- [ ] Meta Model API data-retention period for Responses inputs on
      this account (link + quoted line + date read).
- [ ] Whether inputs may be used for training, and the opt-out (if
      any) and its setting on this account.
- [ ] Whether `"store": true` can be set false per request, and if
      so, do it in `worker/meta.ts` and note the commit here.
