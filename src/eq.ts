// Equality checks.

export const eqSymbol: unique symbol = Symbol();

export type Eq<U> = { [eqSymbol](other: U): boolean }
	| (U extends number ? number | undefined : never)
	| (U extends string ? string | undefined : never)
	| (U extends undefined ? number | string | undefined : never);
export function eq<A extends Eq<B>, B extends unknown>(a: A, b: B): boolean {
	if (typeof a === "number" || typeof a === "string" || typeof a === "undefined") {
		return a === b;
	} else {
		return a[eqSymbol](b);
	}
}

declare global {
	interface Array<T> {
		[eqSymbol]<U>(other: ArrayLike<T extends Eq<U> ? U : never>): boolean;
	}
}
Array.prototype[eqSymbol] = function<T extends Eq<U>, U>(this: Array<T>, other: ArrayLike<U>): boolean {
	if (this.length !== other.length) {
		return false;
	}
	for (let i = 0; i < this.length; i += 1) {
		if (!eq(this[i], other[i])) {
			return false;
		}
	}
	return true;
};

declare global {
	interface Uint8Array {
		[eqSymbol](other: ArrayLike<number>): boolean;
	}
}
Uint8Array.prototype[eqSymbol] = function(this: Uint8Array, other: ArrayLike<number>): boolean {
	if (this.length !== other.length) {
		return false;
	}
	for (let i = 0; i < this.length; i += 1) {
		if (this[i] !== other[i]) {
			return false;
		}
	}
	return true;
};
