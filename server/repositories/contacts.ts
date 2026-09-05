/**
 * Customer-side people. A separate table from `users`, so a portal identity has
 * no representation the internal system can express (DB_SCHEMA.md §2).
 */
import { queryOne, type Queryable } from "../lib/db.ts";
import type { Contact, Id } from "../../shared/types.ts";

interface ContactRow {
  id: Id;
  customer_id: Id;
  customer_name: string;
  email: string;
  full_name: string;
}

const SELECT = `
  SELECT c.id, c.customer_id, cu.name AS customer_name, c.email, c.full_name
    FROM contacts c
    JOIN customers cu ON cu.id = c.customer_id
`;

export async function findById(id: Id, client?: Queryable): Promise<Contact | null> {
  return queryOne<ContactRow>(`${SELECT} WHERE c.id = $1`, [id], client);
}

/**
 * The password fallback path of A1.2. `password_hash` is nullable because a
 * magic-link contact never sets one — a null must read as "cannot log in this
 * way", never as "any password works".
 */
export async function findByEmailWithSecret(
  email: string,
  client?: Queryable,
): Promise<(Contact & { password_hash: string | null }) | null> {
  return queryOne<ContactRow & { password_hash: string | null }>(
    `SELECT c.id, c.customer_id, cu.name AS customer_name, c.email, c.full_name,
            c.password_hash
       FROM contacts c
       JOIN customers cu ON cu.id = c.customer_id
      WHERE c.email = $1`,
    [email],
    client,
  );
}
