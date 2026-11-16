import { Results } from "./duplicates/Results";
import { Scanning, Setup } from "./duplicates/Setup";
import { useDups } from "./duplicates/store";

export function DuplicatesView() {
  const report = useDups((s) => s.report);
  const scanning = useDups((s) => s.scanning);
  if (scanning) return <Scanning />;
  return report ? <Results report={report} /> : <Setup />;
}
