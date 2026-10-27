"use client";
// const { useMock, setUseMock } = useMockMode();
// Starts from NEXT_PUBLIC_USE_MOCK; `?mock=1` / `?mock=0` in the URL overrides it (handy on the demo machine).
// Pages also flip it on automatically when the backend is unreachable, and show <MockBadge/> while it is on.
import { useEffect, useState } from "react";
import { MOCK_BY_DEFAULT } from "@/lib/api";

export function useMockMode() {
  const [useMock, setUseMock] = useState(MOCK_BY_DEFAULT);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const flag = new URLSearchParams(window.location.search).get("mock");
    if (flag === "1" || flag === "true") setUseMock(true);
    if (flag === "0" || flag === "false") setUseMock(false);
    setReady(true);
  }, []);
  return { useMock, setUseMock, ready };
}
