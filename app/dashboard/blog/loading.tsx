function Bar({ className }: { className: string }) {
  return <span className={`block rounded bg-surface-2 ${className}`} />;
}

export default function BlogLoading() {
  const rows = Array.from({ length: 6 });

  return (
    <section
      aria-hidden="true"
      className="flex animate-pulse flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow min-[561px]:min-h-0 min-[561px]:flex-1"
    >
      <div className="flex items-center gap-3 border-b border-border px-5 py-[18px]">
        <Bar className="h-5 w-24" />
        <div className="flex-1" />
        <Bar className="h-[34px] w-28" />
      </div>
      <div className="grid flex-1 grid-cols-[minmax(200px,260px)_1fr] max-[560px]:grid-cols-1">
        <div className="border-r border-border p-[14px] max-[560px]:border-r-0">
          {rows.map((_, i) => (
            <div key={i} className="border-b border-border py-3">
              <Bar className="h-4 w-3/4" />
              <Bar className="mt-2 h-3 w-1/2" />
            </div>
          ))}
        </div>
        <div className="p-[18px] max-[560px]:hidden">
          <Bar className="h-7 w-2/3" />
          <Bar className="mt-4 h-4 w-full" />
          <Bar className="mt-2 h-4 w-5/6" />
        </div>
      </div>
      <p role="status" className="sr-only">
        Loading blog posts…
      </p>
    </section>
  );
}
