import { describe, expect, it } from "vitest";
import { signUploadUrl, verifyUploadSignature, UPLOAD_URL_TTL_MS } from "./upload-sign.js";

describe("upload-sign", () => {
  it("firma una URL y la verifica correctamente", () => {
    const url = signUploadUrl("equipment/maintenance-1.png");
    expect(url).toMatch(/^\/uploads\/equipment\/maintenance-1\.png\?exp=\d+&sig=[0-9a-f]{32}$/);

    const [, query] = url.split("?");
    const params = new URLSearchParams(query);
    expect(verifyUploadSignature("/equipment/maintenance-1.png", params.get("exp"), params.get("sig"))).toBe(true);
  });

  it("acepta la ruta con o sin slash inicial", () => {
    const url = signUploadUrl("/equipment/foto.png");
    const [, query] = url.split("?");
    const params = new URLSearchParams(query);
    expect(verifyUploadSignature("/equipment/foto.png", params.get("exp"), params.get("sig"))).toBe(true);
  });

  it("rechaza la firma de otra ruta (no se puede reusar para otro archivo)", () => {
    const url = signUploadUrl("equipment/a.png");
    const [, query] = url.split("?");
    const params = new URLSearchParams(query);
    expect(verifyUploadSignature("/equipment/b.png", params.get("exp"), params.get("sig"))).toBe(false);
  });

  it("rechaza firmas alteradas o incompletas", () => {
    const url = signUploadUrl("equipment/a.png");
    const [, query] = url.split("?");
    const params = new URLSearchParams(query);
    expect(verifyUploadSignature("/equipment/a.png", params.get("exp"), "0".repeat(32))).toBe(false);
    expect(verifyUploadSignature("/equipment/a.png", params.get("exp"), null)).toBe(false);
    expect(verifyUploadSignature("/equipment/a.png", null, params.get("sig"))).toBe(false);
  });

  it("rechaza URLs expiradas", () => {
    const past = Date.now() - UPLOAD_URL_TTL_MS - 1000;
    const url = signUploadUrl("equipment/vieja.png", past);
    const [, query] = url.split("?");
    const params = new URLSearchParams(query);
    expect(verifyUploadSignature("/equipment/vieja.png", params.get("exp"), params.get("sig"))).toBe(false);
  });
});
