import { deflateRaw, inflateRaw } from "pako";

import { Bytes, BytesMut, BytesReader } from "../bytes";
import { InvalidFormatError, OutdatedError } from "../serde";
import { SharedContact, UnlockedAccount } from "./account";
import { readLenBuffer, readUint8 } from "../serde";
import { writeLenBuffer, writeUint8 } from "../serde";

export const enum DecodedKind { Message, Signed, SharedContact }
export type Decoded = never
	| { kind: DecodedKind.Message, sender: SharedContact, message: Message | null }
	| { kind: DecodedKind.Signed, sender: SharedContact, message: Message, verified: boolean }
	| { kind: DecodedKind.SharedContact, contact: SharedContact };

export const enum MessageKind { Text }
export type Message = never
	| { kind: MessageKind.Text, content: string };

export class NotForYouError { private _: undefined; }

// This function is resistant to mutations to `me`.
export async function decode(me: UnlockedAccount, bytes: Bytes): Promise<Decoded> {
	const dhPrivateKey = me.dhKeyPair.privateKey;
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
export async function encryptMessage(me: UnlockedAccount, recipient: SharedContact | null, message: Message): Promise<Bytes> {
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

	return output.takeBytes();
}

// This function is resistant to mutations to `me` and `message`.
export async function signMessage(me: UnlockedAccount, message: Message): Promise<Bytes> {
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

	return output.takeBytes();
}

export function contactCard(contact: SharedContact): Bytes {
	const encoded = BytesMut.new();
	writeUint8(encoded, 2); // version numebr
	contact.writeTo(encoded);
	return encoded.takeBytes();
}

// WARNING: this function consumes all input, so must be called last.
function readMessage(reader: BytesReader): Message {
	switch (readUint8(reader)) {
		case 0: {
			const content = new TextDecoder().decode(reader.bytes.asImmutableArray());
			reader.advance(reader.bytes.length);
			return { kind: MessageKind.Text, content };
		}
		case 1: {
			const content = inflateRaw(reader.bytes.asImmutableArray(), { to: "string" });
			reader.advance(reader.bytes.length);
			return { kind: MessageKind.Text, content };
		}
		default: throw new OutdatedError();
	}
}

function writeMessage(writer: BytesMut, message: Message): void {
	const bytes = new TextEncoder().encode(message.content);
	const compressed = deflateRaw(bytes, { level: 9 });
	if (compressed.length < bytes.length) {
		writeUint8(writer, 1);
		writer.extend(compressed);
	} else {
		writeUint8(writer, 0);
		writer.extend(bytes);
	}
}
