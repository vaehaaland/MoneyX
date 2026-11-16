export default function Loading() {
  return (
    <div className="space-y-4 p-4 pt-20" aria-busy="true" aria-label="Lastar">
      <div className="h-44 animate-pulse rounded-[28px] bg-surface-container" />
      <div className="h-24 animate-pulse rounded-[28px] bg-surface-low" />
      <div className="h-24 animate-pulse rounded-[28px] bg-surface-low" />
    </div>
  );
}
