export function PageHead({ title, sub, right }: { title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-end gap-4 mb-5 max-w-[1400px] flex-wrap">
      <div className="flex flex-col gap-1 flex-1 min-w-0 basis-full sm:basis-auto sm:min-w-[240px]">
        <h1 className="m-0 text-[22px] font-semibold tracking-[-.015em] leading-tight">{title}</h1>
        {sub ? <div className="text-[13px] text-faint">{sub}</div> : null}
      </div>
      {right}
    </div>
  );
}
