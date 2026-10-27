export function PlaceholderScreen({
  title,
  day,
}: {
  title: string;
  day: string;
}) {
  return (
    <section>
      <h1>{title}</h1>
      <p>Not built yet. It's on the plan for {day}.</p>
      <p className="fine-print">
        This shell ships one feature folder at a time, in plan order, so
        the demo loop always runs end to end on what exists.
      </p>
    </section>
  );
}
