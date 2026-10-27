import type { CheckResult } from "../../shared/checks";

export function CheckList({ results }: { results: CheckResult[] }) {
  return (
    <ul className="check-list">
      {results.map((r) => (
        <li key={r.id} className={r.pass ? "check-pass" : "check-fail"}>
          <span className="check-badge">{r.pass ? "OK" : "FAIL"}</span>
          <strong>{r.label}</strong>
          <span className="check-detail">{r.detail}</span>
        </li>
      ))}
    </ul>
  );
}
