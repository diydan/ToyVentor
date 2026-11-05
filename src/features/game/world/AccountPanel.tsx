import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../../../onboarding.css";
import "../../../accounts.css";
import { createAccountsClient, deviceIsClaimed, looksLikeEmail, offerChild, type AccountsClient, type Result, type Role, type Standing } from "../../../lib/accountsClient";
import { readProfile, type PlayerProfile } from "../../../lib/newPlayer";
import { FORGET_ARM_MS, nextForgetTap } from "../../../lib/returningPlayer";
import { deviceId } from "../../../lib/sync";

const savedProfile = (): PlayerProfile | null => { try { return readProfile(window.localStorage); } catch { return null; } };

/** A button that needs two taps within five seconds (the first arms it), for anything that cannot be undone. */
function TwoTap({ label, armedLabel, onConfirm, disabled }: { label: string; armedLabel: string; onConfirm: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  const armedAt = useRef<number | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const tap = () => {
    const step = nextForgetTap(armedAt.current, Date.now());
    armedAt.current = step.armedAt;
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    if (step.forget) { setArmed(false); onConfirm(); return; }
    setArmed(true);
    timer.current = window.setTimeout(() => { armedAt.current = null; setArmed(false); timer.current = null; }, FORGET_ARM_MS);
  };
  return <button type="button" className={armed ? "tv-ctl tv-ctl-danger" : "tv-ctl"} disabled={disabled} onClick={tap} aria-live="polite">{armed ? armedLabel : label}</button>;
}

/**
 * The "Account" group in the Grown-Ups sheet: a grown-up (or a player who is 13 or older) signs in with an emailed link, then sees the family, adds the player saved on this device, claims this device
 * and signs out or deletes the family. It draws NOTHING unless the Worker has accounts switched on (worker/accounts.ts answers 404 "accounts are off" otherwise), so a visitor never meets it before then.
 * The sheet is behind the grown-up check; the sign-in itself is the grown-up's proof (the link goes to their email).
 */
export function AccountGroup({ client }: { client?: AccountsClient }) {
  const api = useMemo(() => client ?? createAccountsClient(), [client]);
  const [standing, setStanding] = useState<Standing | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("parent");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    void api.standing().then((s) => { if (live) setStanding(s); });
    return () => { live = false; };
  }, [api]);

  const refresh = useCallback(async () => setStanding(await api.standing()), [api]);
  /** Run one call: say what went wrong in words, or what happened, then re-read where we stand. */
  const run = useCallback(async <T,>(call: () => Promise<Result<T>>, said: string, then?: (r: T) => void) => {
    setBusy(true); setNote(null);
    const r = await call();
    if (r.ok) { setNote({ ok: true, text: said }); then?.(r.data); } else setNote({ ok: false, text: r.problem });
    setBusy(false);
    await refresh();
  }, [refresh]);

  if (!standing || standing.kind === "off" || standing.kind === "trouble") return null; // nothing to show until the Worker has accounts on

  const signedIn = standing.kind === "signed-in" ? standing.me : null;
  const profile = savedProfile();
  const offer = signedIn ? offerChild(profile, signedIn) : null;
  const here = deviceId();

  return (
    <details className="tv-disclosure" data-account-group>
      <summary>
        <span>Account</span>
        <span className="tv-disclosure-meta">{signedIn ? "signed in" : "not signed in"}</span>
      </summary>
      <div className="tv-parent-adv tv-acct">
        {!signedIn ? (
          <>
            <p>Sign in with a link sent to an email address, to keep a family's players together. No password. We keep a scrambled copy of the address, never the address itself.</p>
            <label className="tv-acct-field">
              <span>Email address</span>
              <input type="email" inputMode="email" autoComplete="email" value={email} maxLength={120} onChange={(e) => { setEmail(e.target.value); setSent(false); }} className="tv-acct-input" data-account-email />
            </label>
            <div className="tv-acct-roles" role="group" aria-label="Who is signing in">
              <button type="button" className="tv-ctl" aria-pressed={role === "parent"} onClick={() => setRole("parent")}>I'm the grown-up</button>
              <button type="button" className="tv-ctl" aria-pressed={role === "self"} onClick={() => setRole("self")}>I'm 13 or older</button>
            </div>
            <button type="button" className="tv-ctl tv-ctl-primary" disabled={busy || !looksLikeEmail(email)} data-account-send
              onClick={() => void run(() => api.startLogin(email, role), "", () => setSent(true))}>
              Email me a sign-in link
            </button>
            {sent ? <p role="status" className="tv-acct-ok" data-account-sent>Check your email. Open the link on this device within 15 minutes.</p> : null}
          </>
        ) : (
          <>
            <p data-account-who>Signed in{signedIn.parent.role === "parent" ? " as a grown-up" : ""}. {signedIn.children.length === 0 ? "No players in the family yet." : `${signedIn.children.length} ${signedIn.children.length === 1 ? "player" : "players"} in the family.`}</p>
            {signedIn.children.length > 0 ? (
              <ul className="tv-acct-kids">
                {signedIn.children.map((c) => <li key={c.id}>{c.firstName}{c.under13 ? <small> · under 13</small> : null}</li>)}
              </ul>
            ) : null}
            {offer ? (
              <button type="button" className="tv-ctl tv-ctl-primary" disabled={busy} data-account-add-child
                onClick={() => void run(() => api.addChild(offer), `${offer.firstName} is in the family.`)}>
                Add {offer.firstName} to the family
              </button>
            ) : null}
            {deviceIsClaimed(signedIn, here) ? (
              <p className="tv-acct-ok" data-account-device>This device belongs to the family.</p>
            ) : (
              <button type="button" className="tv-ctl" disabled={busy} data-account-claim onClick={() => void run(() => api.claimDevice(here), "This device now belongs to the family.")}>
                Use this device for the family
              </button>
            )}
            <div className="tv-acct-row">
              <button type="button" className="tv-ctl" disabled={busy} data-account-signout onClick={() => void run(() => api.signOut(), "Signed out.")}>Sign out</button>
              <TwoTap label="Delete the family account" armedLabel="Tap again to delete it all" disabled={busy} onConfirm={() => void run(() => api.deleteFamily(), "The family account is deleted.")} />
            </div>
            <p className="tv-onb-note">Deleting removes the family, the players added here and the sign-in. The game on each device stays as it is.</p>
          </>
        )}
        {note && note.text ? <p role={note.ok ? "status" : "alert"} className={note.ok ? "tv-acct-ok" : "tv-acct-bad"} data-account-note>{note.text}</p> : null}
      </div>
    </details>
  );
}

/** One verify per link token, however many times React runs the effect: the link works once, so a second call would report the first one's success as a failure. */
const verifying = new Map<string, Promise<Result<{ ok: boolean; new: boolean }>>>();
export const verifyOnce = (api: AccountsClient, token: string): Promise<Result<{ ok: boolean; new: boolean }>> => {
  let p = verifying.get(token);
  if (!p) { p = api.verify(token); verifying.set(token, p); }
  return p;
};

/** The card that appears when the page was opened from the emailed link (`?signin=...`): it trades the token for a session, says so, and gets out of the way. */
export function SignInLanding({ token, onDone, client }: { token: string; onDone: () => void; client?: AccountsClient }) {
  const api = useMemo(() => client ?? createAccountsClient(), [client]);
  const [state, setState] = useState<{ kind: "working" } | { kind: "ok"; isNew: boolean } | { kind: "bad"; problem: string }>({ kind: "working" });
  useEffect(() => {
    let live = true;
    void verifyOnce(api, token).then((r) => { if (live) setState(r.ok ? { kind: "ok", isNew: !!r.data.new } : { kind: "bad", problem: r.problem }); });
    return () => { live = false; };
  }, [api, token]);
  return (
    <div className="tv-onb tv-signin" role="dialog" aria-modal="true" aria-label="Signing in" data-signin-landing>
      <div className="tv-onb-card">
        {state.kind === "working" ? <h2 className="tv-onb-h">Signing you in…</h2> : null}
        {state.kind === "ok" ? (
          <>
            <h2 className="tv-onb-h">You're signed in!</h2>
            <p className="tv-onb-p">{state.isNew ? "Your family account is ready. " : "Welcome back. "}Open Grown-Ups, then Account, to add players and use this device for the family.</p>
          </>
        ) : null}
        {state.kind === "bad" ? (
          <>
            <h2 className="tv-onb-h">That did not work</h2>
            <p className="tv-onb-p" role="alert">{state.problem}</p>
          </>
        ) : null}
        <div className="tv-onb-nav">
          <button type="button" className="tv-ctl tv-ctl-primary" onClick={onDone} disabled={state.kind === "working"} data-signin-done>{state.kind === "ok" ? "Let's play" : "Close"}</button>
        </div>
      </div>
    </div>
  );
}
