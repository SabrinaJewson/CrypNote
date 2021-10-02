// Infrastructure for supporting generic-over-async functions.

export type MaybePromise<T> = T | Promise<T>;
export type MaybePromiseOutput<P> = P extends Promise<infer T> ? T : P;

export type MaybeThen<P1, P2> = P1 extends Promise<infer _> ? Promise<MaybePromiseOutput<P2>> : P2;
export function maybeThen<P1, P2>(
	p: P1,
	f: (value: MaybePromiseOutput<P1>) => P2,
): MaybeThen<P1, P2> {
	return (p instanceof Promise ? p.then(f) : f(p as MaybePromiseOutput<P1>)) as MaybeThen<P1, P2>;
}
