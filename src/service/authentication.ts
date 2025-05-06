import { pool } from "../database/postgreSQL";

export const getUser = async (username: string): Promise<Boolean> => {
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
    if (result.rows.length > 0) {
        return true;
    }
    return false;
}