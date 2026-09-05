/**
 * Parameterised SQL for internal users. No business logic lives here, and no
 * SQL lives anywhere else (TRD.md §2).
 */
import { query, queryOne, type Queryable } from "../lib/db.ts";
import type { Id, Role, User } from "../../shared/types.ts";

/** The shape the database returns, before it becomes the wire shape. */
interface UserRow {
  id: Id;
  email: string;
  full_name: string;
  role: Role;
  sales_team_id: Id | null;
  sales_team_name: string | null;
  is_active: boolean;
  created_at: Date;
}

interface UserWithSecretRow extends UserRow {
  password_hash: string;
}

/**
 * Every user select goes through this list, so `password_hash` can only reach
 * a caller that asked for it by name — see `findByEmailWithSecret`.
 */
const PUBLIC_COLUMNS = `
  u.id, u.email, u.full_name, u.role, u.sales_team_id,
  t.name AS sales_team_name, u.is_active, u.created_at
`;

const FROM = "FROM users u LEFT JOIN sales_teams t ON t.id = u.sales_team_id";

/** TIMESTAMPTZ arrives as a Date; the contract says ISO string (shared/types.ts). */
function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    role: row.role,
    sales_team_id: row.sales_team_id,
    sales_team_name: row.sales_team_name,
    is_active: row.is_active,
    created_at: row.created_at.toISOString(),
  };
}

export async function findById(id: Id, client?: Queryable): Promise<User | null> {
  const row = await queryOne<UserRow>(
    `SELECT ${PUBLIC_COLUMNS} ${FROM} WHERE u.id = $1`,
    [id],
    client,
  );
  return row ? toUser(row) : null;
}

/**
 * The only function that returns a password hash, and it says so in its name.
 * Callers are the login path and nothing else.
 */
export async function findByEmailWithSecret(
  email: string,
  client?: Queryable,
): Promise<(User & { password_hash: string }) | null> {
  const row = await queryOne<UserWithSecretRow>(
    `SELECT ${PUBLIC_COLUMNS}, u.password_hash ${FROM} WHERE u.email = $1`,
    [email],
    client,
  );
  return row ? { ...toUser(row), password_hash: row.password_hash } : null;
}

export async function emailExists(email: string, client?: Queryable): Promise<boolean> {
  const row = await queryOne<{ exists: boolean }>(
    "SELECT true AS exists FROM users WHERE email = $1",
    [email],
    client,
  );
  return row !== null;
}

/**
 * `role` is a parameter of this function but never of a request body. Signup
 * passes "rep"; only an admin-authenticated path may pass anything else
 * (TRD.md §3, mass-assignment defence).
 */
export async function insert(
  input: { email: string; password_hash: string; full_name: string; role: Role },
  client?: Queryable,
): Promise<User> {
  const rows = await query<{ id: Id }>(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [input.email, input.password_hash, input.full_name, input.role],
    client,
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("INSERT INTO users returned no id");
  const created = await findById(id, client);
  if (created === null) throw new Error("Newly created user could not be read back");
  return created;
}
