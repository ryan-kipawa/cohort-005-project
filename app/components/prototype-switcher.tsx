// PROTOTYPE — throwaway floating variant switcher (← / → keys too).
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function PrototypeSwitcher({
  variants,
  current,
}: {
  variants: Record<string, string>;
  current: string;
}) {
  const [, setParams] = useSearchParams();
  const keys = Object.keys(variants);
  const i = Math.max(0, keys.indexOf(current));
  const go = (d: number) =>
    setParams({ variant: keys[(i + d + keys.length) % keys.length] });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (import.meta.env.PROD) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full bg-zinc-900 px-2 py-1.5 text-sm text-white shadow-2xl ring-2 ring-amber-400">
      <button onClick={() => go(-1)} className="rounded-full p-1 hover:bg-zinc-700">
        <ChevronLeft className="size-4" />
      </button>
      <span className="px-2 font-medium">
        {keys[i]} <span className="text-zinc-400">({variants[keys[i]]})</span>
      </span>
      <button onClick={() => go(1)} className="rounded-full p-1 hover:bg-zinc-700">
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
