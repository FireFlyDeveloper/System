import { sign, verify } from "jsonwebtoken";

export const generateToken = (user: any) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not defined");
  }
  return sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: "31d",
  });
};

export const verifyToken = (token: string) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not defined");
  }
  return verify(token, process.env.JWT_SECRET);
};
