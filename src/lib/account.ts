import { Bytes, BytesMut, BytesReader } from "../bytes";
import { InvalidFormatError, OutdatedError } from "../serde";
import { KeyPair, StoredKeyPair, StoredPrivateKey, StoredPublicKey, readKeyPair, writeKeyPair } from "./crypto";
import { Password, UnlockedPassword } from "./password";
import { eq, eqSymbol } from "../eq";
import { readLenBuffer, readLenString, readUint32, readUint8 } from "../serde";
import { writeLenBuffer, writeLenString, writeUint32, writeUint8 } from "../serde";

export class LockedAccount {
	private constructor(
		readonly password: Password,
		readonly iv: Bytes,
		readonly encryptedData: Bytes,
		readonly publicDataBuffer: Bytes,
		readonly publicData: AccountPublic,
	) {}

	static async readFrom(reader: BytesReader): Promise<LockedAccount> {
		switch (readUint8(reader)) {
			case 0: {
				const password = Password.readFrom(reader);
				const iv = readLenBuffer(reader, 1);
				const encryptedData = readLenBuffer(reader, 4);
				const publicDataBufferStart = reader.bytes;
				const publicData = await readAccountPublic(reader);
				const publicDataBuffer = publicDataBufferStart.slice(0, publicDataBufferStart.length - reader.bytes.length);
				return new LockedAccount(password, iv, encryptedData, publicDataBuffer, publicData);
			}
			default: throw new OutdatedError();
		}
	}

	writeTo(writer: BytesMut): void {
		writeUint8(writer, 0); // version number
		this.password.writeTo(writer);
		writeLenBuffer(writer, 1, this.iv);
		writeLenBuffer(writer, 4, this.encryptedData);
		writer.extend(this.publicDataBuffer);
	}

	// This method is resistant to concurrent mutations to `unlocked`.
	static async lock(unlocked: UnlockedAccount): Promise<LockedAccount> {
		const password = unlocked.password;
		const publicData = { ...unlocked.publicData };

		const publicDataBuffer = Bytes.buildWith(writer => writeAccountPublic(writer, publicData));
		const privateDataBuffer = Bytes.buildWith(writer => {
			writeUint8(writer, 0); // version number
			unlocked.dsaPrivateKey.writeTo(writer);
			writeKeyPair(writer, unlocked.dhKeyPair);
			writeUint32(writer, unlocked.contacts.length);
			for (const contact of unlocked.contacts) {
				writeContact(writer, contact);
			}
		});

		const iv = Bytes.fromImmutableArray(crypto.getRandomValues(new Uint8Array(12)));
		const encryptedData = Bytes.fromImmutableBuffer(await crypto.subtle.encrypt(
			{
				name: "AES-GCM",
				iv: iv.asImmutableArray(),
				additionalData: publicDataBuffer.asImmutableArray(),
			},
			password.key,
			privateDataBuffer.asImmutableArray(),
		));

		return new LockedAccount(password.locked, iv, encryptedData, publicDataBuffer, publicData);
	}

	async unlock(passwordGuess: string): Promise<UnlockedAccount> {
		const unlockedPassword = await UnlockedPassword.unlock(this.password, passwordGuess);

		let privateDataBuffer: Bytes;
		try {
			privateDataBuffer = Bytes.fromImmutableBuffer(await crypto.subtle.decrypt(
				{
					name: "AES-GCM",
					iv: this.iv.asImmutableArray(),
					additionalData: this.publicDataBuffer.asImmutableArray(),
				},
				unlockedPassword.key,
				this.encryptedData.asImmutableArray(),
			));
		} catch (e) {
			if (e instanceof Error && e.name === "OperationError") {
				throw new TamperedError();
			} else {
				throw e;
			}
		}

		const reader = new BytesReader(privateDataBuffer);
		switch (readUint8(reader)) {
			case 0: {
				const dsaPrivateKey = await StoredPrivateKey.readFrom(reader, ["sign"], this.publicData.dsaPublicKey.inner);
				const dhKeyPair = await readKeyPair(reader, "ECDH", ["deriveKey"]);

				const contacts: Contact[] = [];
				const contactsLen = readUint32(reader);
				for (let i = 0; i < contactsLen; i += 1) {
					contacts.push(await readContact(reader));
				}

				return {
					password: unlockedPassword,
					publicData: this.publicData,
					dsaPrivateKey,
					dhKeyPair,
					contacts,
				};
			}
			default: throw new OutdatedError();
		}
	}

	[eqSymbol](other: LockedAccount): boolean {
		return eq(this.publicData.dsaPublicKey, other.publicData.dsaPublicKey);
	}
}

export interface UnlockedAccount {
	readonly password: UnlockedPassword,
	readonly publicData: AccountPublic,
	readonly dsaPrivateKey: StoredPrivateKey,
	readonly dhKeyPair: StoredKeyPair,
	readonly contacts: Contact[],
}

export async function createAccount(name: string, passwordString: string): Promise<UnlockedAccount> {
	const unlockedPassword = await UnlockedPassword.new(passwordString);

	const dsaKeyPair = await crypto.subtle.generateKey(
		{ name: "ECDSA", namedCurve: "P-256" },
		true,
		["sign"],
	) as KeyPair;

	const dhKeyPair = await crypto.subtle.generateKey(
		{ name: "ECDH", namedCurve: "P-256" },
		true,
		["deriveKey"],
	) as KeyPair;

	return {
		password: unlockedPassword,
		publicData: { name, dsaPublicKey: await StoredPublicKey.new(dsaKeyPair.publicKey) },
		dsaPrivateKey: await StoredPrivateKey.new(dsaKeyPair.privateKey),
		dhKeyPair: {
			publicKey: await StoredPublicKey.new(dhKeyPair.publicKey),
			privateKey: await StoredPrivateKey.new(dhKeyPair.privateKey),
		},
		contacts: [],
	};
}

export class TamperedError {
	private _: undefined;
}

export interface AccountPublic {
	readonly name: string,
	readonly dsaPublicKey: StoredPublicKey,
}

function writeAccountPublic(writer: BytesMut, account: AccountPublic): void {
	writeUint8(writer, 0); // version number
	writeLenString(writer, 1, account.name);
	account.dsaPublicKey.writeTo(writer);
}

async function readAccountPublic(reader: BytesReader): Promise<AccountPublic> {
	switch (readUint8(reader)) {
		case 0: {
			const name = new TextDecoder().decode(readLenBuffer(reader, 1).asImmutableArray());
			const dsaPublicKey = await StoredPublicKey.readFrom(reader, "ECDSA");
			return { name, dsaPublicKey };
		}
		default: throw new OutdatedError();
	}
}

export interface Contact {
	readonly shared: SharedContact,
	readonly nickname: string,
	readonly note: string,
}

function writeContact(writer: BytesMut, contact: Contact): void {
	writeUint8(writer, 0); // version number
	contact.shared.writeTo(writer);
	writeLenString(writer, 1, contact.nickname);
	writeLenString(writer, 4, contact.note);
}

async function readContact(reader: BytesReader): Promise<Contact> {
	switch (readUint8(reader)) {
		case 0: {
			const shared = await SharedContact.readFrom(reader);
			const nickname = readLenString(reader, 1);
			const note = readLenString(reader, 4);
			return { shared, nickname, note };
		}
		default: throw new OutdatedError();
	}
}

export class SharedContact {
	private constructor(
		readonly dsaPublicKey: StoredPublicKey,
		readonly dhPublicKey: StoredPublicKey,
		readonly signature: Bytes,
		readonly signatureHash: number,
	) {}

	// This function is resistant to mutations to `account`.
	static async ofAccount(account: UnlockedAccount): Promise<SharedContact> {
		const dsaPublicKey = account.publicData.dsaPublicKey;
		const dhPublicKey = account.dhKeyPair.publicKey;

		const toSign = Bytes.buildWith(writer => dhPublicKey.writeTo(writer));
		const signature = Bytes.fromImmutableBuffer(await crypto.subtle.sign(
			{ name: "ECDSA", hash: "SHA-256" },
			account.dsaPrivateKey.inner,
			toSign.asImmutableArray(),
		));
		return new SharedContact(dsaPublicKey, dhPublicKey, signature, 0);
	}

	isAccount(account: UnlockedAccount): boolean {
		return eq(this.dsaPublicKey, account.publicData.dsaPublicKey);
	}

	writeTo(writer: BytesMut): void {
		writeUint8(writer, 0); // version number
		this.dsaPublicKey.writeTo(writer);
		this.dhPublicKey.writeTo(writer);
		writeLenBuffer(writer, 1, this.signature);
		writeUint8(writer, this.signatureHash);
	}

	static async readFrom(reader: BytesReader): Promise<SharedContact> {
		let self: SharedContact;
		let toVerify: Bytes;
		switch (readUint8(reader)) {
			case 0: {
				const dsaPublicKey = await StoredPublicKey.readFrom(reader, "ECDSA", ["verify"]);
				const toVerifyStart = reader.bytes;
				const dhPublicKey = await StoredPublicKey.readFrom(reader, "ECDH");
				toVerify = toVerifyStart.slice(0, toVerifyStart.length - reader.bytes.length);
				const signature = readLenBuffer(reader, 1);
				const signatureHash = readUint8(reader);
				self = new SharedContact(dsaPublicKey, dhPublicKey, signature, signatureHash);
				break;
			}
			default: throw new OutdatedError();
		}

		let signatureHashName: string;
		switch (self.signatureHash) {
			case 0: signatureHashName = "SHA-256"; break;
			case 1: signatureHashName = "SHA-384"; break;
			case 2: signatureHashName = "SHA-512"; break;
			default: throw new OutdatedError();
		}

		const verified = await crypto.subtle.verify(
			{ name: "ECDSA", hash: signatureHashName },
			self.dsaPublicKey.inner,
			self.signature.asImmutableArray(),
			toVerify.asImmutableArray(),
		);
		if (!verified) {
			throw new InvalidFormatError();
		}

		return self;
	}

	[eqSymbol](other: SharedContact): boolean {
		return eq(this.dsaPublicKey, other.dsaPublicKey);
	}
}
