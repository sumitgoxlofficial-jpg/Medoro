/**
 * Shown on server-side analysis screens when the pharmacy's records live on its own counters and in its Google Drive (hosted
 * "Drive mode"). The server holds none of those bills, stock or purchases, so these screens have nothing to analyse; saying so
 * is better than showing a page of confident-looking zeros.
 */
export function DriveModeNote({ moved }: { moved?: boolean }) {
  if (!moved) return null;
  return (
    <p role="note" data-testid="drive-mode-note" className="m-0 mb-3 text-[12.5px] text-slate-700 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 max-w-[1400px]">
      Your pharmacy’s records live on your counters and in your own Google Drive, not on Medoro’s server, so this screen has no bills, stock or purchases to analyse and will look empty. Use the Insights tab inside Billing (device) for your own data.
    </p>
  );
}
