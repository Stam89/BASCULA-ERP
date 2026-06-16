export function calculateNetWeight(grossWeight: number, tareWeight: number): number {
  return round3(grossWeight - tareWeight);
}

export function calculateQuintals(netWeight: number, qualification: number): number {
  if (qualification <= 0) {
    throw new Error("La calificacion debe ser mayor que cero");
  }
  return round3((netWeight * 2.2) / qualification);
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
