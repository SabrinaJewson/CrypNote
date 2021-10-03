// Utilities for serializing and deserializing to and from bytes.

import { Bytes, BytesMut, BytesReader } from "./bytes";
import { assertEq, test } from "./test";

export class InvalidFormatError {
	private _: undefined;
}
export class OutdatedError {
	private _: undefined;
}

export function requireBytes(reader: BytesReader, space: number): void {
	if (reader.bytes.length < space) {
		throw new InvalidFormatError();
	}
}

export function readUint8(reader: BytesReader): number {
	requireBytes(reader, 1);
	const byte = reader.bytes[0];
	reader.advance(1);
	return byte;
}
export function writeUint8(writer: BytesMut, n: number): void {
	writer.push(n);
}

export function readUint16(reader: BytesReader): number {
	requireBytes(reader, 2);
	const val = reader.bytes[0] << 8 | reader.bytes[1];
	reader.advance(2);
	return val;
}
export function writeUint16(writer: BytesMut, n: number): void {
	writer.extend([n >>> 8, n & 0xFF]);
}

export function readUint32(reader: BytesReader): number {
	requireBytes(reader, 4);
	const val = reader.bytes[0] << 24 | reader.bytes[1] << 16 | reader.bytes[2] << 8 | reader.bytes[3];
	reader.advance(4);
	return val >>> 0;
}
export function writeUint32(writer: BytesMut, n: number): void {
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

export function readLenBuffer(reader: BytesReader, bytes: 1 | 2 | 4): Bytes {
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
export function writeLenBuffer(writer: BytesMut, bytes: 1 | 2 | 4, buffer: ArrayLike<number>): void {
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

export function readLenString(reader: BytesReader, bytes: 1 | 2 | 4): string {
	return new TextDecoder().decode(readLenBuffer(reader, bytes).asImmutableArray());
}
export function writeLenString(writer: BytesMut, bytes: 1 | 2 | 4, s: string): void {
	writeLenBuffer(writer, bytes, new TextEncoder().encode(s));
}
