/* packages/seam-react/__tests__/use-seam-data.test.ts */

import { describe, it, expect, afterEach } from "vitest";
import { useSeamData, setSSRData, clearSSRData } from "../src/index.js";

describe("useSeamData", () => {
  afterEach(() => {
    clearSSRData();
  });

  it("returns SSR data when set", () => {
    const data = { user: { id: 1, name: "Alice" } };
    setSSRData(data);
    const result = useSeamData<typeof data>();
    expect(result).toBe(data);
  });

  it("throws when no data is available", () => {
    expect(() => useSeamData()).toThrow("No seam data available");
  });

  it("clears SSR data", () => {
    setSSRData({ user: { id: 1 } });
    clearSSRData();
    expect(() => useSeamData()).toThrow("No seam data available");
  });
});
