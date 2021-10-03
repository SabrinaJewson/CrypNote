import { Bytes, BytesMut, BytesReader } from "../bytes";
import { readLenBuffer, readUint32, readUint8 } from "../serde";
import { writeLenBuffer, writeUint32, writeUint8 } from "../serde";
import { OutdatedError } from "../serde";
import { eq } from "../eq";

export class Password {
	constructor(
		readonly salt: Bytes,
		readonly iterations: number,
		readonly hasher: PasswordHasher,
		readonly hash: Bytes,
	) {}

	writeTo(writer: BytesMut): void {
		writeUint8(writer, 0); // version number
		writeLenBuffer(writer, 1, this.salt);
		writeUint32(writer, this.iterations);
		writeUint8(writer, this.hasher);
		writeLenBuffer(writer, 4, this.hash);
	}

	static readFrom(reader: BytesReader): Password {
		switch (readUint8(reader)) {
			case 0: {
				const salt = readLenBuffer(reader, 1);
				const iterations = readUint32(reader);
				const hasher = readUint8(reader);
				if (!isPasswordHasher(hasher)) {
					throw new OutdatedError();
				}
				const hash = readLenBuffer(reader, 4);
				return new Password(salt, iterations, hasher, hash);
			}
			default: throw new OutdatedError();
		}
	}
}

export class IncorrectPassword {
	private _: undefined;
}

export type PasswordHasher = 0;
function isPasswordHasher(hasher: number): hasher is PasswordHasher {
	return hasher === 0;
}

async function hashPassword(password: string, salt: Bytes, iterations: number, hasher: PasswordHasher): Promise<[CryptoKey, Bytes]> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		"PBKDF2",
		false,
		["deriveKey"],
	);
	const firstHash = await crypto.subtle.deriveKey(
		{ name: "PBKDF2", hash: "SHA-256", salt: salt.asImmutableArray(), iterations },
		key,
		{ name: "AES-GCM", length: 256 },
		true,
		["encrypt", "decrypt"],
	);
	const firstHashBytes = await crypto.subtle.exportKey("raw", firstHash);
	let secondHash: ArrayBuffer;
	switch (hasher) {
		case 0: secondHash = await crypto.subtle.digest("SHA-256", firstHashBytes); break;
	}
	return [firstHash, Bytes.fromImmutableBuffer(secondHash)];
}

export class UnlockedPassword {
	private constructor(
		readonly locked: Password,
		readonly key: CryptoKey,
	) {}

	static async new(password: string): Promise<UnlockedPassword> {
		const salt = Bytes.fromImmutableArray(crypto.getRandomValues(new Uint8Array(64)));
		const iterations = 128;
		const hasher = 0;
		const [dataKey, hash] = await hashPassword(password, salt, iterations, hasher);
		return new UnlockedPassword(new Password(salt, iterations, hasher, hash), dataKey);
	}

	static async unlock(locked: Password, guess: string): Promise<UnlockedPassword> {
		const [dataKey, guessHash] = await hashPassword(guess, locked.salt, locked.iterations, locked.hasher);
		if (!eq(guessHash, locked.hash)) {
			throw new IncorrectPassword();
		}
		return new UnlockedPassword(locked, dataKey);
	}
}
