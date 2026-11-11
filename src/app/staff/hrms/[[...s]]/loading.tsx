/** Shown the instant a menu item is clicked, while the next page is fetched, so the screen never feels frozen. */
export default function Loading() {
  return (
    <div className="flex min-h-screen" aria-busy="true" aria-label="Loading">
      <aside className="w-[210px] flex-none bg-[#0B5E5B] max-[859px]:hidden" />
      <div className="flex-1 min-w-0 flex flex-col gap-4 px-6 max-[560px]:px-3 py-6">
        <div className="h-7 w-56 rounded-lg bg-[#E2E8F0] animate-pulse" />
        <div className="h-4 w-80 max-w-full rounded bg-[#E2E8F0] animate-pulse" />
        <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))" }}>
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-[86px] rounded-[14px] bg-white border border-[#E2E8F0] animate-pulse" />)}
        </div>
        <div className="h-[320px] rounded-[14px] bg-white border border-[#E2E8F0] animate-pulse" />
      </div>
    </div>
  );
}
