"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="text-sm text-[var(--text-muted)]">{error.message}</p>
      <button
        onClick={() => reset()}
        className="gradient-btn px-5 py-2.5 rounded-xl text-sm font-semibold"
      >
        Try again
      </button>
    </div>
  );
}
