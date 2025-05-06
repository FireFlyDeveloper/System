import { pool } from "../database/postgreSQL";
import { verifyPassword, hashPassword } from "../utils/auth";

export const createTable = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  try {
    await pool.query(query);
    console.log("Users table created successfully");
  } catch (error) {
    console.error("Error creating users table:", error);
  }
};

export const getUser = async (
  username: string,
  password: string,
): Promise<Boolean> => {
  try {
    const result = await pool.query(
      "SELECT password FROM users WHERE username = $1",
      [username],
    );
    if (result.rows.length > 0) {
      const hashedPassword = result.rows[0].password;
      const isMatch = await verifyPassword(password, hashedPassword);
      return isMatch;
    }
    return false;
  } catch (error) {
    console.error("Error fetching user:", error);
    return false;
  }
};

export const createUser = async (): Promise<boolean> => {
  const adminUsername = "admin";
  const adminPassword = "admin";

  try {
    const existingUser = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [adminUsername],
    );

    if (existingUser.rows.length > 0) {
      console.log("Admin user already exists");
      return false;
    }

    const hashedPassword = await hashPassword(adminPassword);
    await pool.query("INSERT INTO users (username, password) VALUES ($1, $2)", [
      adminUsername,
      hashedPassword,
    ]);

    console.log("Admin user created successfully");
    return true;
  } catch (error) {
    console.error("Error creating admin user:", error);
    return false;
  }
};

export const updateUser = async (
  username: string,
  password: string,
): Promise<Boolean> => {
  const hashedPassword = await hashPassword(password);
  try {
    await pool.query("UPDATE users SET password = $1 WHERE username = $2", [
      hashedPassword,
      username,
    ]);
    return true;
  } catch (error) {
    console.error("Error updating user:", error);
    return false;
  }
};
