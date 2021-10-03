import { Bytes, BytesMut, BytesReader } from "../bytes";
import { InvalidFormatError, OutdatedError, requireBytes } from "../serde";
import { base64UrlDecode, base64UrlEncode } from "../base64";
import { eq, eqSymbol } from "../eq";

interface AsymmetricKey extends CryptoKey {
	readonly algorithm: EcKeyAlgorithm,
}
interface EcKeyAlgorithm extends KeyAlgorithm {
	name: KeyAlgorithmName,
	namedCurve: NamedCurve,
}
type KeyAlgorithmName = "ECDH" | "ECDSA";
type NamedCurve = "P-256" | "P-384" | "P-521";
export interface PublicKey extends AsymmetricKey {
	readonly type: "public",
}
export interface PrivateKey extends AsymmetricKey {
	readonly type: "private",
}
export interface KeyPair extends CryptoKeyPair {
	readonly privateKey: PrivateKey,
	readonly publicKey: PublicKey,
}

export class StoredPublicKey {
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

export class StoredPrivateKey {
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

export interface StoredKeyPair {
	readonly publicKey: StoredPublicKey,
	readonly privateKey: StoredPrivateKey,
}

export function writeKeyPair(writer: BytesMut, pair: StoredKeyPair): void {
	pair.publicKey.writeTo(writer);
	pair.privateKey.writeTo(writer);
}

export async function readKeyPair(reader: BytesReader, algorithm: KeyAlgorithmName, keyOps: KeyUsage[]): Promise<StoredKeyPair> {
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
