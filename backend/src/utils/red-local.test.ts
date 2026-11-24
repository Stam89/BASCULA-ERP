import { describe, expect, it } from "vitest";
import { esIpDelLocal, vieneDeInternet } from "./red-local.js";

describe("red del local o internet", () => {
  it("reconoce las direcciones del local", () => {
    for (const ip of ["127.0.0.1", "::1", "::ffff:192.168.88.20", "192.168.88.7", "10.0.2.2", "172.16.0.4", "172.31.9.9", "fd12::1", "fe80::1"]) {
      expect(esIpDelLocal(ip), ip).toBe(true);
    }
    for (const ip of ["186.3.4.5", "172.32.0.1", "172.15.0.1", "2800:bf0::1", "", null]) expect(esIpDelLocal(ip), String(ip)).toBe(false);
  });

  it("lo que entra por el túnel es internet", () => {
    expect(vieneDeInternet({ ip: "192.168.88.20", headers: {} })).toBe(false);
    expect(vieneDeInternet({ ip: "186.3.4.5", headers: {} })).toBe(true);
    expect(vieneDeInternet({ ip: "127.0.0.1", headers: { "cf-connecting-ip": "186.3.4.5" } })).toBe(true);
    expect(vieneDeInternet({ ip: "127.0.0.1", headers: { "cf-ray": "abc" } })).toBe(true);
    expect(vieneDeInternet({ ip: "127.0.0.1", headers: {} })).toBe(false);
    expect(vieneDeInternet({ ip: "186.3.4.5", headers: { "cf-connecting-ip": "192.168.1.1" } })).toBe(true);
  });
});
