// Library-like access to all the functionality of CrypNote.
//
// The files in this directory differ from the files in the `src/` root in that they are specific to
// CrypNote, as opposed to being potentially generic utilities.

export * as db from "./db";
export type { Db } from "./db";

export { LockedAccount, SharedContact, TamperedError, createAccount } from "./account";
export type { AccountPublic, Contact, UnlockedAccount } from "./account";
export { IncorrectPassword } from "./password";
