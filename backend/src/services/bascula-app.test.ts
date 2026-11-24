import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { appPublicada } from "./bascula-app.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "app-tablet-"));
const poner = (m: unknown) => fs.writeFileSync(path.join(dir, "bascula-update.json"), typeof m === "string" ? m : JSON.stringify(m));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("instalador de la tablet", () => {
  const bueno = { versionCode: 249, versionName: "11.58", archivo: "Bascula-v11.58.apk", sha256: "a".repeat(64) };
  it("sin carpeta, sin archivo o con manifiesto malo no ofrece nada", () => {
    expect(appPublicada(path.join(dir, "no-existe"))).toBeNull();
    poner(bueno);
    expect(appPublicada(dir)).toBeNull();
    poner("{no es json");
    expect(appPublicada(dir)).toBeNull();
    poner({ ...bueno, archivo: "../secreto.apk" });
    expect(appPublicada(dir)).toBeNull();
    poner({ ...bueno, sha256: "corta" });
    expect(appPublicada(dir)).toBeNull();
  });
  it("con el archivo en su lugar, sí", () => {
    fs.writeFileSync(path.join(dir, bueno.archivo), "apk");
    poner(bueno);
    expect(appPublicada(dir)).toMatchObject({ versionCode: 249, tamano: 3, notes: "" });
  });
});
