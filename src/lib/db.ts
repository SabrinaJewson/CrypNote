import { createSignal } from "solid-js";

import { Bytes, BytesMut, BytesReader } from "../bytes";
import { InvalidFormatError, OutdatedError } from "../serde";
import { base64Decode, base64Encode } from "../base64";
import { readUint32, readUint8 } from "../serde";
import { writeUint32, writeUint8 } from "../serde";
import { LockedAccount } from "./account";

export interface Db {
	accounts: LockedAccount[],
	accountBin: LockedAccount[],
	keylogged: boolean,
	scraped: boolean,
}

const [disabled, setDisabled] = createSignal(false);
export { disabled };

export async function load(): Promise<Db> {
	const serialized = localStorage.getItem("state");
	if (serialized === null) {
		return createDefault();
	}

	addEventListener("storage", () => setDisabled(true));

	const bytes = Bytes.buildWith(writer => {
		try {
			return base64Decode(serialized, writer);
		} catch (e) {
			throw new LoadError(new InvalidFormatError(), serialized);
		}
	});

	try {
		return await read(new BytesReader(bytes));
	} catch (e) {
		throw new LoadError(e, hex(bytes));
	}
}

export function store(db: Db): void {
	const buffer = Bytes.buildWith(buffer => write(buffer, db));
	localStorage.setItem("state", base64Encode(buffer));
}

export class LoadError {
	constructor(
		readonly cause: unknown,
		readonly stored: string,
	) {}

	isUnexpected(): boolean {
		return !(this.cause instanceof OutdatedError);
	}

	topMessage(): string {
		if (this.cause instanceof OutdatedError) {
			return "Your client is outdated; please upgrade.";
		} else if (this.cause instanceof InvalidFormatError) {
			return "Stored data is not in a valid format. It may have been tampered with, or this may be a bug in the program.";
		} else {
			return "An unexpected error occurred. This is a bug.";
		}
	}
}

export function createDefault(): Db {
	return {
		accounts: [],
		accountBin: [],
		keylogged: true,
		scraped: true,
	};
}

function write(writer: BytesMut, db: Db): void {
	writeUint8(writer, 0); // version number

	writeUint32(writer, db.accounts.length);
	for (const account of db.accounts) {
		account.writeTo(writer);
	}

	writeUint32(writer, db.accountBin.length);
	for (const account of db.accountBin) {
		account.writeTo(writer);
	}

	writeUint8(writer, Number(db.keylogged) << 1 | Number(db.scraped) << 0);
}

async function read(reader: BytesReader): Promise<Db> {
	switch (readUint8(reader)) {
		case 0: {
			const accountsLen = readUint32(reader);
			const accounts: LockedAccount[] = [];
			for (let i = 0; i < accountsLen; i += 1) {
				accounts.push(await LockedAccount.readFrom(reader));
			}

			const accountBinLen = readUint32(reader);
			const accountBin: LockedAccount[] = [];
			for (let i = 0; i < accountBinLen; i += 1) {
				accountBin.push(await LockedAccount.readFrom(reader));
			}

			const nextByte = readUint8(reader);
			const keylogged = (nextByte & 2) !== 0;
			const scraped = (nextByte & 1) !== 0;
			return { accounts, accountBin, keylogged, scraped };
		}
		default: throw new OutdatedError();
	}
}

function hex(bytes: Bytes): string {
	let s = "";
	for (const [i, byte] of bytes.entries()) {
		s += byte.toString(16).padStart(2, "0");
		if (i % 4 === 3) {
			s += " ";
		}
	}
	return s;
}
