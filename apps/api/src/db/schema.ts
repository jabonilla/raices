/**
 * The typed database schema Kysely builds against.
 *
 * P0.4 ships no tables: the ledger schema is P1.2's ticket. The interface
 * exists so `Kysely<Database>` is nameable from the start and P1.2 only has to
 * add members.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Database {}
