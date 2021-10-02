import { MaybePromise, MaybeThen, maybeThen } from "./maybePromise";
import { assertEq, test } from "./test";
import { eqSymbol } from "./eq";

// An immutable and shared byte buffer.
//
// This type has two layers of immutability: the underlying array is immutable, and the value itself
// is also immutable.
export class Bytes implements ArrayLike<number> {
	private constructor(private inner: Uint8Array) {}

	// Create a `Bytes` instance from an array that is guaranteed to be immutable.
	static fromImmutableArray(inner: Uint8Array): Bytes {
		return new Proxy(
			new Bytes(inner),
			{
				get: (target: Bytes, property: string | symbol): unknown => {
					const i = propertyIndex(property);
					if (i !== undefined) {
						return target.inner[i];
					}
					return Reflect.get(target, property);
				},
			}
		);
	}

	// Create a `Bytes` instance from a buffer that is guaranteed to be immutable.
	static fromImmutableBuffer(buffer: ArrayBuffer): Bytes {
		return Bytes.fromImmutableArray(new Uint8Array(buffer));
	}

	static copyFromBuffer(buffer: ArrayBuffer, begin: number = 0, end?: number): Bytes {
		return Bytes.fromImmutableBuffer(buffer.slice(begin, end));
	}

	static copyFromUint8Array(array: Uint8Array): Bytes {
		return Bytes.fromImmutableArray(array.slice(0));
	}

	// Get the `Bytes`' underlying `Uint8Array`. The caller must guarantee that it won't be mutated.
	asImmutableArray(): Uint8Array {
		return this.inner;
	}

	get length(): number {
		return this.inner.length;
	}

	readonly [index: number]: number;

	slice(start: number, end?: number): Bytes {
		return Bytes.fromImmutableArray(this.inner.subarray(start, end));
	}

	static buildWith<P extends MaybePromise<void>>(f: (writer: BytesMut) => P): MaybeThen<P, Bytes> {
		const writer = BytesMut.new();
		return maybeThen(f(writer), () => writer.takeBytes());
	}

	toBytesMut(): BytesMut {
		return BytesMut.copyFromBuffer(
			this.inner.buffer,
			this.inner.byteOffset,
			this.inner.byteOffset + this.inner.byteLength,
		);
	}

	toString(): string {
		return this.inner.toString();
	}

	[Symbol.iterator](): IterableIterator<number> {
		return this.inner[Symbol.iterator]();
	}

	entries(): IterableIterator<[number, number]> {
		return this.inner.entries();
	}

	[eqSymbol](other: ArrayLike<number>): boolean {
		if (this.length !== other.length) {
			return false;
		}
		for (let i = 0; i < this.length; i += 1) {
			if (this[i] !== other[i]) {
				return false;
			}
		}
		return true;
	}
}

test("Bytes", () => {
	const bytes = Bytes.fromImmutableArray(new Uint8Array([1, 2, 3]));
	assertEq(bytes.length, 3);
	assertEq(bytes[0], 1);
	assertEq(bytes[1], 2);
	assertEq(bytes[2], 3);
	assertEq(bytes[3], undefined);
	assertEq(bytes.asImmutableArray(), [1, 2, 3]);
	assertEq(bytes, [1, 2, 3]);

	assertEq(bytes.slice(0), [1, 2, 3]);
	assertEq(bytes.slice(1), [2, 3]);
	assertEq(bytes.slice(3), []);
	assertEq(bytes.slice(0, 2), [1, 2]);
	assertEq(bytes.slice(1, 2), [2]);
	assertEq(bytes.slice(2, 2), []);

	assertEq(bytes.toString(), "1,2,3");

	assertEq([...bytes], [1, 2, 3]);
	assertEq([...bytes.entries()], [[0, 1], [1, 2], [2, 3]]);
});

// A reader into a `Bytes` instance.
export class BytesReader {
	constructor(private bytes_: Bytes) {}

	get bytes(): Bytes {
		return this.bytes_;
	}

	isEmpty(): boolean {
		return this.bytes.length === 0;
	}

	advance(by: number): void {
		this.bytes_ = this.bytes.slice(by);
	}
}

// A mutable and unique byte buffer.
export class BytesMut implements ArrayLike<number> {
	private constructor(
		private inner: ArrayBuffer,
		private length_: number,
	) {}

	// Create a `BytesMut` instance from buffer that is guaranteed to be uniquely owned.
	static fromUniqueBuffer(inner: ArrayBuffer, length: number = inner.byteLength): BytesMut {
		return new Proxy(
			new BytesMut(inner, length),
			{
				get: (target: BytesMut, property: string | symbol): unknown => {
					const i = propertyIndex(property);
					if (i !== undefined && i < target.length) {
						return new Uint8Array(target.inner)[i];
					}
					return Reflect.get(target, property);
				},
				set: (target: BytesMut, property: string | symbol, value: unknown): boolean => {
					const i = propertyIndex(property);
					if (i !== undefined && i < target.length && typeof value === "number") {
						new Uint8Array(target.inner)[i] = value;
						return true;
					}
					return Reflect.set(target, property, value);
				},
			},
		);
	}

	static new(capacity: number = 0): BytesMut {
		return BytesMut.fromUniqueBuffer(new ArrayBuffer(capacity), 0);
	}

	static zeroed(length: number): BytesMut {
		return BytesMut.fromUniqueBuffer(new Uint8Array(length).buffer);
	}

	static copyFromBuffer(buffer: ArrayBuffer, begin: number = 0, end?: number): BytesMut {
		return BytesMut.fromUniqueBuffer(buffer.slice(begin, end));
	}

	get capacity(): number {
		return this.inner.byteLength;
	}

	get length(): number {
		return this.length_;
	}

	[index: number]: number;

	reserve(bytes: number): void {
		if (bytes > this.capacity - this.length) {
			const oldBuffer = this.inner;
			this.inner = new ArrayBuffer(Math.max(
				oldBuffer.byteLength * 2,
				this.length + bytes,
				64,
			));
			new Uint8Array(this.inner).set(new Uint8Array(oldBuffer));
		}
	}

	push(byte: number): void {
		this.reserve(1);
		new Uint8Array(this.inner)[this.length] = byte;
		this.length_ += 1;
	}

	extend(buffer: ArrayLike<number>): void {
		this.reserve(buffer.length);
		new Uint8Array(this.inner).set(buffer, this.length);
		this.length_ += buffer.length;
	}

	toString(): string {
		return new Uint8Array(this.inner, 0, this.length).toString();
	}

	[Symbol.iterator](): IterableIterator<number> {
		return new Uint8Array(this.inner, 0, this.length)[Symbol.iterator]();
	}

	swap(other: BytesMut): void {
		[this.inner, other.inner] = [other.inner, this.inner];
		[this.length_, other.length_] = [other.length_, this.length_];
	}

	take(): BytesMut {
		const other = BytesMut.new();
		this.swap(other);
		return other;
	}

	takeArray(): Uint8Array {
		const bytes = this.take();
		return new Uint8Array(bytes.inner, 0, bytes.length);
	}

	takeBytes(): Bytes {
		return Bytes.fromImmutableArray(this.takeArray());
	}

	clone(): BytesMut {
		return BytesMut.fromUniqueBuffer(this.inner.slice(0), this.length);
	}
}

test("BytesMut", () => {
	const bytes = BytesMut.new();
	assertEq(bytes.capacity, 0);
	assertEq(bytes.length, 0);
	assertEq(bytes.toString(), "");
	assertEq(bytes[0], undefined);
	assertEq(bytes.clone().takeBytes(), []);

	bytes.push(1);
	assertEq(bytes.capacity, 64);
	assertEq(bytes.length, 1);
	assertEq(bytes.toString(), "1");
	assertEq(bytes[0], 1);
	assertEq(bytes[1], undefined);
	assertEq(bytes.clone().takeBytes(), [1]);

	bytes.extend([2, 5]);
	assertEq(bytes.capacity, 64);
	assertEq(bytes.length, 3);
	assertEq(bytes.toString(), "1,2,5");
	assertEq(bytes[0], 1);
	assertEq(bytes[1], 2);
	assertEq(bytes[2], 5);
	assertEq(bytes[3], undefined);
	assertEq(bytes.clone().takeBytes(), [1, 2, 5]);

	bytes[2] = 3;
	assertEq(bytes.length, 3);
	assertEq(bytes[2], 3);
	assertEq(bytes.clone().takeBytes(), [1, 2, 3]);

	bytes[3] = 6;
	assertEq(bytes.length, 3);
	assertEq(bytes.clone().takeBytes(), [1, 2, 3]);

	bytes.extend(Array(64).fill(6));
	assertEq(bytes.capacity, 128);
	assertEq(bytes.length, 67);

	bytes.extend(Array(213).fill(7));
	assertEq(bytes.capacity, 280);
	assertEq(bytes.length, 280);

	assertEq(Bytes.buildWith(writer => writer.extend([1, 2, 3])), [1, 2, 3]);
});

// Check if a given property access is accessing an index.
function propertyIndex(property: string | symbol): number | undefined {
	if (typeof property === "string" && /^[1-9][0-9]*|0$/.test(property)) {
		return parseInt(property);
	}
}

test("propertyIndex", () => {
	assertEq(propertyIndex(Symbol()), undefined);
	assertEq(propertyIndex(""), undefined);
	assertEq(propertyIndex("0"), 0);
	assertEq(propertyIndex("05"), undefined);
	assertEq(propertyIndex(" 5"), undefined);
	assertEq(propertyIndex("5"), 5);
	assertEq(propertyIndex("10"), 10);
});
