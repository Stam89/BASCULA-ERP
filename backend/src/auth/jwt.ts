import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export type AuthUser = {
  id: string;
  username: string;
  name: string;
  role_id: string | null;
  role_name?: string | null;
  allowed_modules?: string[] | null;
};

export function signToken(user: AuthUser): string {
  return jwt.sign(user, env.jwtSecret, { expiresIn: "12h" });
}

export function verifyToken(token: string): AuthUser {
  return jwt.verify(token, env.jwtSecret) as AuthUser;
}
