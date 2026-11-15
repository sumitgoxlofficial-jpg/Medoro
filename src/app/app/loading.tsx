/** Shown the instant a menu item is clicked (the sidebar stays), so a screen that is still loading never looks frozen. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-4 p-6 max-[560px]:p-3" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-56 rounded-lg bg-line animate-pulse" />
      <div className="h-4 w-80 max-w-full rounded bg-line animate-pulse" />
      <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))" }}>
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-[86px] rounded-[14px] bg-white border border-line animate-pulse" />)}
      </div>
      <div className="h-[320px] rounded-[14px] bg-white border border-line animate-pulse" />
    </div>
  );
}
