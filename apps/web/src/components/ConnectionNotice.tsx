import { useEffect, useState } from "react";

/** Whether the browser believes it is online, updating as the connection comes and goes. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

/** A calm banner while the connection is down. Pages load again by themselves when it returns. */
export function ConnectionNotice() {
  const online = useOnline();
  if (online) return null;
  return (
    <p role="status" className="bg-ink px-4 py-2 text-center text-sm text-cream">
      You’re offline. Some things may not load until your connection is back.
    </p>
  );
}
