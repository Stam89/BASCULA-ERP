import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { signToken } from "../../auth/jwt.js";

export const authRouter = Router();

authRouter.post("/login", asyncRoute(async (req, res) => {
  const body = z.object({
    username: z.string().min(2),
    password: z.string().min(4)
  }).parse(req.body);

  const result = await pool.query(
    `SELECT u.*, r.name AS role_name
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.username = $1 AND u.is_active = true`,
    [body.username]
  );

  if (!result.rowCount) {
    throw new ApiError(401, "Usuario o clave incorrectos");
  }

  const user = result.rows[0];
  const valid = await bcrypt.compare(body.password, user.password_hash);
  if (!valid) {
    throw new ApiError(401, "Usuario o clave incorrectos");
  }

  const publicUser = {
    id: user.id,
    username: user.username,
    name: user.name,
    role_id: user.role_id,
    role_name: user.role_name
  };

  res.json({
    token: signToken(publicUser),
    user: publicUser
  });
}));
