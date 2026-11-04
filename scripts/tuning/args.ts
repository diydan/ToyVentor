/** A tiny argument reader for the tuning scripts: `--flag value`, `--flag=value` and bare `--flag`. No dependencies. */
export function parseArgs(argv: readonly string[]): { flags: Record<string, string | true>; rest: string[] } {
  const flags: Record<string, string | true> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) { rest.push(a); continue; }
    const eq = a.indexOf("=");
    if (eq > 0) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) { flags[a.slice(2)] = next; i++; } else flags[a.slice(2)] = true;
  }
  return { flags, rest };
}
export const str = (f: Record<string, string | true>, k: string): string | undefined => (typeof f[k] === "string" ? (f[k] as string) : undefined);
export const num = (f: Record<string, string | true>, k: string, d: number): number => {
  const v = str(f, k);
  const n = v === undefined ? d : Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${k} must be a non-negative number`);
  return n;
};
