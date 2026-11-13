import { useEffect } from "react";
import { useRevalidator } from "react-router";

/** Reruns the page's loaders when the window regains focus, and at no other time. */
export function useRevalidateOnFocus() {
  const { revalidate } = useRevalidator();

  useEffect(() => {
    function onFocus() {
      void revalidate();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [revalidate]);
}
