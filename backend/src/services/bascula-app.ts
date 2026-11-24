// 📲 APP DE LA TABLET: el ERP guarda el instalador de la versión vigente y la tablet (v11.58 o posterior) lo ofrece sola.
// Carpeta backend/app-tablet (no se versiona): bascula-update.json + el APK que ahí se nombra. La app comprueba el SHA-256 y
// Android exige la misma firma, así que un archivo cambiado no se instala.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

const aqui = path.dirname(fileURLToPath(import.meta.url));
export const CARPETA_APP = process.env.BASCULA_APP_DIR || path.join(aqui, "..", "..", "app-tablet");

const manifiestoSchema = z.object({
  versionCode: z.number().int().positive(),
  versionName: z.string().trim().min(1).max(20),
  archivo: z.string().regex(/^[A-Za-z0-9._-]+\.apk$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  notes: z.string().max(2000).optional().default("")
});

export type AppDeTablet = z.infer<typeof manifiestoSchema> & { ruta: string; tamano: number };

/** La versión publicada, o null si no hay (o el manifiesto o el archivo no sirven). */
export function appPublicada(carpeta = CARPETA_APP): AppDeTablet | null {
  try {
    const m = manifiestoSchema.parse(JSON.parse(fs.readFileSync(path.join(carpeta, "bascula-update.json"), "utf8")));
    const ruta = path.join(carpeta, m.archivo);
    const st = fs.statSync(ruta);
    return st.isFile() && st.size > 0 ? { ...m, ruta, tamano: st.size } : null;
  } catch {
    return null;
  }
}
