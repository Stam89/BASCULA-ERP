import { expect, test } from "vitest";
import { anotarCambio, marcaDeCambios } from "./cambios.js";

test("lo que guarda otro equipo cambia la marca; lo propio no", () => {
  const pc = marcaDeCambios("pc"), cel = marcaDeCambios("cel");
  anotarCambio("cel");
  expect(marcaDeCambios("cel")).toBe(cel);
  expect(marcaDeCambios("pc")).not.toBe(pc);
  const pc2 = marcaDeCambios("pc");
  anotarCambio("pc");
  expect(marcaDeCambios("pc")).toBe(pc2);
  anotarCambio();
  expect(marcaDeCambios("pc")).not.toBe(pc2);
});
