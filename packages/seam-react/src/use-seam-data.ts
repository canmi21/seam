let ssrData: Record<string, unknown> | null = null;

export function setSSRData(data: Record<string, unknown>): void {
  ssrData = data;
}

export function clearSSRData(): void {
  ssrData = null;
}

export function useSeamData<T extends Record<string, unknown>>(): T {
  if (ssrData) return ssrData as T;
  if (typeof document !== "undefined") {
    const el = document.getElementById("__SEAM_DATA__");
    if (el?.textContent) return JSON.parse(el.textContent) as T;
  }
  throw new Error("No seam data available");
}
