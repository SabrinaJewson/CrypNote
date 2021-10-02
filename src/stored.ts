// TODO: split up this file

import { createSignal } from "solid-js";

import { Bytes, BytesMut, BytesReader } from "./bytes";
import { assertEq, test } from "./test";
import { base64Decode, base64Encode, base64UrlDecode, base64UrlEncode } from "./base64";
import { eq, eqSymbol } from "./eq";

export interface Stored {
	accounts: LockedAccount[],
	keylogged: boolean,
	scraped: boolean,
}

const [disabled, setDisabled] = createSignal(false);
export { disabled };

export async function loadStored(): Promise<Stored> {
	const serialized = localStorage.getItem("state");
	if (serialized === null) {
		return defaultStored();
	}

	addEventListener("storage", () => setDisabled(true));

	const bytes = Bytes.buildWith(writer => {
		try {
			return base64Decode(serialized, writer);
		} catch (e) {
			throw new LoadStoredError(new InvalidFormatError(), serialized);
		}
	});

	try {
		return await readStored(new BytesReader(bytes));
	} catch (e) {
		throw new LoadStoredError(e, hex(bytes));
	}
}

export function storeStored(stored: Stored): void {
	const buffer = Bytes.buildWith(buffer => writeStored(buffer, stored));
	localStorage.setItem("state", base64Encode(buffer));
}

export class LoadStoredError {
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

export function defaultStored(): Stored {
	return {
		accounts: [],
		keylogged: true,
		scraped: true,
	};
}

export class OutdatedError {
	private _: undefined;
}

export class InvalidFormatError {
	private _: undefined;
}

function writeStored(writer: BytesMut, stored: Stored): void {
	writeUint8(writer, 0); // version number
	writeUint32(writer, stored.accounts.length);
	for (const account of stored.accounts) {
		account.writeTo(writer);
	}
	writeUint8(writer, Number(stored.keylogged) << 1 | Number(stored.scraped) << 0);
}

async function readStored(reader: BytesReader): Promise<Stored> {
	switch (readUint8(reader)) {
		case 0: {
			const accountsLen = readUint32(reader);
			const accounts: LockedAccount[] = [];
			for (let i = 0; i < accountsLen; i += 1) {
				accounts.push(await LockedAccount.readFrom(reader));
			}

			const nextByte = readUint8(reader);
			const keylogged = (nextByte & 2) !== 0;
			const scraped = (nextByte & 1) !== 0;
			return { accounts, keylogged, scraped };
		}
		default: throw new OutdatedError();
	}
}

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

	// This method is asynchronous, but resistant to concurrent mutations to `unlocked`.
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

interface AsymmetricKey extends CryptoKey {
	readonly algorithm: EcKeyAlgorithm,
}
interface EcKeyAlgorithm extends KeyAlgorithm {
	name: KeyAlgorithmName,
	namedCurve: NamedCurve,
}
type KeyAlgorithmName = "ECDH" | "ECDSA";
type NamedCurve = "P-256" | "P-384" | "P-521";
interface PublicKey extends AsymmetricKey {
	readonly type: "public",
}
interface PrivateKey extends AsymmetricKey {
	readonly type: "private",
}
interface KeyPair extends CryptoKeyPair {
	readonly privateKey: PrivateKey,
	readonly publicKey: PublicKey,
}

class StoredPublicKey {
	private constructor(
		readonly inner: PublicKey,
		private readonly serialized: Bytes,
	) {}

	static async new(inner: PublicKey): Promise<StoredPublicKey> {
		let curveNum: number;
		switch (inner.algorithm.namedCurve) {
			case "P-256": curveNum = 0; break;
			case "P-384": curveNum = 1; break;
			case "P-521": curveNum = 2; break;
		}

		const raw = await crypto.subtle.exportKey("raw", inner);

		const serialized = new Uint8Array(raw, 0, 1 + raw.byteLength >>> 1);
		serialized[0] = curveNum << 2 | 2 | (new Uint8Array(raw)[raw.byteLength - 1] & 1);

		return new StoredPublicKey(inner, Bytes.fromImmutableArray(serialized));
	}

	static async readFrom(
		reader: BytesReader,
		algorithm: KeyAlgorithmName,
		keyOps: KeyUsage[] = [],
	): Promise<StoredPublicKey> {
		let namedCurve: NamedCurve;
		switch (reader.bytes[0] >>> 2) {
			case 0: namedCurve = "P-256"; break;
			case 1: namedCurve = "P-384"; break;
			case 2: namedCurve = "P-521"; break;
			default: throw new OutdatedError();
		}

		requireBytes(reader, keyLen(namedCurve) + 1);
		const serialized = reader.bytes.slice(0, keyLen(namedCurve) + 1);
		reader.advance(serialized.length);

		const raw = serialized.toBytesMut();
		raw[0] &= 0b0000_0011;
		try {
			const inner = await crypto.subtle.importKey(
				"raw",
				raw.takeArray(),
				{ name: algorithm, namedCurve },
				true,
				keyOps,
			) as PublicKey;
			return new StoredPublicKey(inner, serialized);
		} catch (e) {
			if (e instanceof TypeError) {
				throw new InvalidFormatError();
			} else {
				throw e;
			}
		}
	}

	writeTo(writer: BytesMut): void {
		writer.extend(this.serialized);
	}

	toString(): string {
		return base64UrlEncode(this.serialized);
	}

	[eqSymbol](other: StoredPublicKey): boolean {
		return eq(this.serialized, other.serialized);
	}
}

class StoredPrivateKey {
	private constructor(
		readonly inner: PrivateKey,
		private readonly serialized: Bytes,
	) {}

	static async new(inner: PrivateKey): Promise<StoredPrivateKey> {
		const jwk = await crypto.subtle.exportKey("jwk", inner);
		return new StoredPrivateKey(inner, Bytes.buildWith(writer => base64UrlDecode(jwk.d!, writer)));
	}

	static async readFrom(reader: BytesReader, keyOps: KeyUsage[], publicKey: PublicKey): Promise<StoredPrivateKey> {
		requireBytes(reader, keyLen(publicKey.algorithm.namedCurve));
		const serialized = reader.bytes.slice(0, keyLen(publicKey.algorithm.namedCurve));

		const jwk = await crypto.subtle.exportKey("jwk", publicKey);
		jwk.d = base64UrlEncode(serialized);
		reader.advance(keyLen(publicKey.algorithm.namedCurve));
		jwk.key_ops = keyOps;
		try {
			const inner = await crypto.subtle.importKey(
				"jwk",
				jwk,
				{ name: publicKey.algorithm.name, namedCurve: jwk.crv },
				true,
				keyOps,
			) as PrivateKey;
			return new StoredPrivateKey(inner, serialized);
		} catch (e) {
			if (e instanceof TypeError) {
				throw new InvalidFormatError();
			} else {
				throw e;
			}
		}
	}

	writeTo(writer: BytesMut): void {
		writer.extend(this.serialized);
	}
}

interface StoredKeyPair {
	readonly publicKey: StoredPublicKey,
	readonly privateKey: StoredPrivateKey,
}

function writeKeyPair(writer: BytesMut, pair: StoredKeyPair): void {
	pair.publicKey.writeTo(writer);
	pair.privateKey.writeTo(writer);
}

async function readKeyPair(reader: BytesReader, algorithm: KeyAlgorithmName, keyOps: KeyUsage[]): Promise<StoredKeyPair> {
	const publicKey = await StoredPublicKey.readFrom(reader, algorithm);
	const privateKey = await StoredPrivateKey.readFrom(reader, keyOps, publicKey.inner);
	return { publicKey, privateKey };
}

function keyLen(curve: NamedCurve): number {
	switch (curve) {
		case "P-256": return 32;
		case "P-384": return 48;
		case "P-521": return 66;
	}
}

class Password {
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

type PasswordHasher = 0;
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

export enum DecodedKind { Message, Signed, SharedContact }
export type Decoded = never
	| { kind: DecodedKind.Message, sender: SharedContact, message: Message | null }
	| { kind: DecodedKind.Signed, sender: SharedContact, message: Message, verified: boolean }
	| { kind: DecodedKind.SharedContact, contact: SharedContact };

export enum MessageKind { Text }
export type Message = never
	| { kind: MessageKind.Text, content: string };

export class NotForYouError { private _: undefined; }

// This function is resistant to mutations to `me`.
export async function decode(me: UnlockedAccount, base64: string): Promise<Decoded> {
	const dhPrivateKey = me.dhKeyPair.privateKey;

	const bytes = Bytes.buildWith(writer => {
		try {
			return base64UrlDecode(base64, writer);
		} catch (e) {
			throw new InvalidFormatError();
		}
	});

	const reader = new BytesReader(bytes);

	switch (readUint8(reader)) {
		case 0: {
			const senderBytesStart = reader.bytes;
			const sender = await SharedContact.readFrom(reader);
			const senderBytes = senderBytesStart.slice(0, senderBytesStart.length - reader.bytes.length);

			const key = await crypto.subtle.deriveKey(
				{ name: "ECDH", public: sender.dhPublicKey.inner },
				dhPrivateKey.inner,
				{ name: "AES-GCM", length: 256 },
				false,
				["decrypt"],
			);

			const iv = readLenBuffer(reader, 1);
			const ciphertext = readLenBuffer(reader, 4);

			if (!reader.isEmpty()) {
				throw new InvalidFormatError();
			}

			let decrypted: Bytes | null = null;
			try {
				decrypted = Bytes.fromImmutableBuffer(await crypto.subtle.decrypt(
					{
						name: "AES-GCM",
						iv: iv.asImmutableArray(),
						additionalData: senderBytes.asImmutableArray(),
					},
					key,
					ciphertext.asImmutableArray(),
				));
			} catch (e) {
				if (!(e instanceof Error && e.name === "OperationError")) {
					throw e;
				}
			}

			const message = decrypted === null ? null : readMessage(new BytesReader(decrypted));

			return { kind: DecodedKind.Message, sender, message };
		}
		case 1: {
			const sender = await SharedContact.readFrom(reader);
			const signature = readLenBuffer(reader, 1);
			const toVerify = reader.bytes;
			const message = readMessage(reader);

			const verified = await crypto.subtle.verify(
				{ name: "ECDSA", hash: "SHA-256" },
				sender.dsaPublicKey.inner,
				signature.asImmutableArray(),
				toVerify.asImmutableArray(),
			);

			return { kind: DecodedKind.Signed, sender, message, verified };
		}
		case 2: {
			const contact = await SharedContact.readFrom(reader);
			if (!reader.isEmpty()) {
				throw new InvalidFormatError();
			}
			return { kind: DecodedKind.SharedContact, contact };
		}
		default: throw new OutdatedError();
	}
}

// This function is resistant to mutations to `me` and `message`.
export async function encryptMessage(me: UnlockedAccount, recipient: SharedContact | null, message: Message): Promise<string> {
	const toEncrypt = Bytes.buildWith(writer => writeMessage(writer, message));

	const senderPromise = SharedContact.ofAccount(me);
	const keyPromise = crypto.subtle.deriveKey(
		{
			name: "ECDH",
			public: (recipient === null ? me.dhKeyPair.publicKey : recipient.dhPublicKey).inner
		},
		me.dhKeyPair.privateKey.inner,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt"],
	);
	const [sender, key] = [await senderPromise, await keyPromise];
	const senderBytes = Bytes.buildWith(writer => sender.writeTo(writer));

	const iv = Bytes.fromImmutableArray(crypto.getRandomValues(new Uint8Array(12)));

	const ciphertext = Bytes.fromImmutableBuffer(await crypto.subtle.encrypt(
		{
			name: "AES-GCM",
			iv: iv.asImmutableArray(),
			additionalData: senderBytes.asImmutableArray(),
		},
		key,
		toEncrypt.asImmutableArray(),
	));

	const output = BytesMut.new();
	writeUint8(output, 0); // version number
	output.extend(senderBytes);
	writeLenBuffer(output, 1, iv);
	writeLenBuffer(output, 4, ciphertext);

	return base64UrlEncode(output);
}

// This function is resistant to mutations to `me` and `message`.
export async function signMessage(me: UnlockedAccount, message: Message): Promise<string> {
	const dsaPrivateKey = me.dsaPrivateKey;

	const toSign = Bytes.buildWith(writer => writeMessage(writer, message));

	const sender = await SharedContact.ofAccount(me);

	const signature = Bytes.fromImmutableBuffer(await crypto.subtle.sign(
		{ name: "ECDSA", hash: "SHA-256" },
		dsaPrivateKey.inner,
		toSign.asImmutableArray(),
	));

	const output = BytesMut.new();
	writeUint8(output, 1); // version number
	sender.writeTo(output);
	writeLenBuffer(output, 1, signature);
	output.extend(toSign);

	return base64UrlEncode(output);
}

export function contactCard(contact: SharedContact): string {
	const message = BytesMut.new();
	writeUint8(message, 2); // version numebr
	contact.writeTo(message);
	return base64UrlEncode(message);
}

// WARNING: this function consumes all input, so must be called last.
function readMessage(reader: BytesReader): Message {
	switch (readUint8(reader)) {
		case 0: {
			const content = new TextDecoder().decode(reader.bytes.asImmutableArray());
			reader.advance(reader.bytes.length);
			return { kind: MessageKind.Text, content };
		}
		default: throw new OutdatedError();
	}
}

function writeMessage(writer: BytesMut, message: Message): void {
	writeUint8(writer, 0); // version number
	writer.extend(new TextEncoder().encode(message.content));
}

function requireBytes(reader: BytesReader, space: number): void {
	if (reader.bytes.length < space) {
		throw new InvalidFormatError();
	}
}

function readUint8(reader: BytesReader): number {
	requireBytes(reader, 1);
	const byte = reader.bytes[0];
	reader.advance(1);
	return byte;
}
function writeUint8(writer: BytesMut, n: number): void {
	writer.push(n);
}

function readUint16(reader: BytesReader): number {
	requireBytes(reader, 2);
	const val = reader.bytes[0] << 8 | reader.bytes[1];
	reader.advance(2);
	return val;
}
function writeUint16(writer: BytesMut, n: number): void {
	writer.extend([n >>> 8, n & 0xFF]);
}

function readUint32(reader: BytesReader): number {
	requireBytes(reader, 4);
	const val = reader.bytes[0] << 24 | reader.bytes[1] << 16 | reader.bytes[2] << 8 | reader.bytes[3];
	reader.advance(4);
	return val >>> 0;
}
function writeUint32(writer: BytesMut, n: number): void {
	writer.extend([n >>> 24, (n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF]);
}

test("read/write integers", () => {
	function roundtrip<T>(
		write: (writer: BytesMut, val: T) => void,
		read: (reader: BytesReader) => T,
		val: T,
	): T {
		const reader = new BytesReader(Bytes.buildWith(writer => write(writer, val)));
		const result = read(reader);
		assertEq(reader.bytes, []);
		return result;
	}

	assertEq(roundtrip(writeUint8, readUint8, 0), 0);
	assertEq(roundtrip(writeUint8, readUint8, 255), 255);
	assertEq(roundtrip(writeUint16, readUint16, 5), 5);
	assertEq(roundtrip(writeUint16, readUint16, 63195), 63195);
	assertEq(roundtrip(writeUint32, readUint32, 0), 0);
	assertEq(roundtrip(writeUint32, readUint32, 63195), 63195);
	assertEq(roundtrip(writeUint32, readUint32, 2 ** 32 - 5), 2 ** 32 - 5);
});

function readLenBuffer(reader: BytesReader, bytes: 1 | 2 | 4): Bytes {
	let length: number;
	switch (bytes) {
		case 1: length = readUint8(reader); break;
		case 2: length = readUint16(reader); break;
		case 4: length = readUint32(reader); break;
	}
	requireBytes(reader, length);
	const buffer = reader.bytes.slice(0, length);
	reader.advance(length);
	return buffer;
}
function writeLenBuffer(writer: BytesMut, bytes: 1 | 2 | 4, buffer: ArrayLike<number>): void {
	switch (bytes) {
		case 1: writeUint8(writer, buffer.length); break;
		case 2: writeUint16(writer, buffer.length); break;
		case 4: writeUint32(writer, buffer.length); break;
	}
	writer.extend(buffer);
}

test("read/write len buffers", () => {
	function roundtrip(bytes: 1 | 2 | 4, array: number[]): void {
		const reader = new BytesReader(Bytes.buildWith(writer => writeLenBuffer(writer, bytes, array)));
		assertEq(readLenBuffer(reader, bytes), array);
		assertEq(reader.bytes, []);
	}
	roundtrip(1, []);
	roundtrip(2, []);
	roundtrip(4, []);
	roundtrip(1, [1, 2, 3]);
	roundtrip(2, [1, 2, 3]);
	roundtrip(4, [1, 2, 3]);
	roundtrip(1, Array(255).fill(5));
	roundtrip(2, Array(256).fill(5));
	roundtrip(2, Array(65535).fill(5));
	roundtrip(4, Array(65536).fill(5));
});

function readLenString(reader: BytesReader, bytes: 1 | 2 | 4): string {
	return new TextDecoder().decode(readLenBuffer(reader, bytes).asImmutableArray());
}
function writeLenString(writer: BytesMut, bytes: 1 | 2 | 4, s: string): void {
	writeLenBuffer(writer, bytes, new TextEncoder().encode(s));
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
