import { describe, expect, it } from "vitest";
import { fechaMasMeses, generarTablaCuotas, tasaDesdeCuota } from "./prestamos.js";

describe("préstamos bancarios: tabla de cuotas", () => {
  it("fechas: mismo día cada mes y el último día cuando el mes es corto", () => {
    expect(fechaMasMeses("2026-10-31", 1, 31)).toBe("2026-11-30");
    expect(fechaMasMeses("2026-10-31", 4, 31)).toBe("2027-02-28");
    expect(fechaMasMeses("2026-12-15", 1, 15)).toBe("2027-01-15");
    expect(fechaMasMeses("2026-10-05", 3, 5)).toBe("2027-01-05");
  });

  it("con tasa: cuota fija, interés sobre el saldo y el capital suma lo prestado", () => {
    const t = generarTablaCuotas({ capital: 12000, cuotas: 12, primeraFecha: "2026-11-05", tasaAnual: 12 });
    expect(t.cuota).toBe(1066.19);
    expect(t.filas).toHaveLength(12);
    expect(t.filas[0]).toMatchObject({ numero: 1, fecha: "2026-11-05", interes: 120, capital: 946.19 });
    expect(t.filas[11].fecha).toBe("2027-10-05");
    expect(Math.round(t.filas.reduce((s, f) => s + f.capital, 0) * 100) / 100).toBe(12000);
  });

  it("sin tasa pero con la cuota del banco: despeja la tasa", () => {
    const t = generarTablaCuotas({ capital: 12000, cuotas: 12, primeraFecha: "2026-11-05", cuota: 1066.19 });
    expect(Math.abs(t.tasa_anual - 12)).toBeLessThan(0.01);
    expect(Math.round(t.filas.reduce((s, f) => s + f.capital, 0) * 100) / 100).toBe(12000);
  });

  it("sin tasa ni cuota: capital en partes iguales; otros cargos en cada cuota; trimestral", () => {
    const t = generarTablaCuotas({ capital: 1000, cuotas: 3, primeraFecha: "2026-10-20", frecuenciaMeses: 3, otrosPorCuota: 5 });
    expect(t.filas.map((f) => f.capital)).toEqual([333.33, 333.33, 333.34]);
    expect(t.filas.map((f) => f.fecha)).toEqual(["2026-10-20", "2027-01-20", "2027-04-20"]);
    expect(t.filas[0].total).toBe(338.33);
  });

  it("una cuota que no alcanza a pagar el capital es un error claro", () => {
    expect(() => generarTablaCuotas({ capital: 1000, cuotas: 3, primeraFecha: "2026-10-20", cuota: 300 })).toThrow(/no se alcanza/);
    expect(tasaDesdeCuota(1000, 300, 4)).toBeGreaterThan(0);
  });
});
