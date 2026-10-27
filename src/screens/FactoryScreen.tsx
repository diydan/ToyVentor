import { useToybox } from "../state/toybox";

export function FactoryScreen({
  onScan,
  onToybox,
}: {
  onScan: () => void;
  onToybox: () => void;
}) {
  const { toys } = useToybox();
  return (
    <section>
      <h1>ToyForge</h1>
      <p className="lede">
        Scan a toy your kid already owns. Bolt something better onto it.
      </p>
      {toys.length > 0 ? (
        <button type="button" className="cta" onClick={onToybox}>
          Continue — {toys.length} {toys.length === 1 ? "toy" : "toys"} in your Toybox
        </button>
      ) : (
        <button type="button" className="cta" onClick={onScan}>
          Scan your first toy
        </button>
      )}
      <p className="fine-print">
        Foundation build: builder, AR, and the game arrive over the next
        plan days. Today the scan path runs on the backup toy.
      </p>
    </section>
  );
}
