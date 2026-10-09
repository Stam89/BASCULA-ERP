import { describe, expect, it } from "vitest";
import { createDeviceToken, hashDeviceToken } from "./bascula-device-auth.js";

describe("credencial individual de Bascula", () => {
  it("genera tokens distintos y conserva solamente un hash estable", () => {
    const first = createDeviceToken();
    const second = createDeviceToken();
    expect(first).toMatch(/^bdt_[A-Za-z0-9_-]{40,}$/);
    expect(second).not.toBe(first);
    expect(hashDeviceToken(first)).toHaveLength(64);
    expect(hashDeviceToken(first)).toBe(hashDeviceToken(first));
    expect(hashDeviceToken(first)).not.toBe(first);
  });
});
