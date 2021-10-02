// Minimal testing framework.

import { Eq, eq } from "./eq";
import { MaybePromise, MaybeThen, maybeThen } from "./maybePromise";

export function test(name: string, f: () => MaybePromise<void>): void {
	if (process.env.NODE_ENV !== "production") {
		tests.push([name, f]);
	}
}

const tests: [string, () => MaybePromise<void>][] = [];

if (process.env.NODE_ENV !== "production") {
	const button = document.createElement("button");
	button.type = "button";
	button.append("Run tests");
	button.addEventListener("click", () => void runTests());
	document.body.append(button);
}

export async function runTests(): Promise<void> {
	console.log(`Running ${tests.length} tests`);
	
	const start = Date.now();
	let successes = 0;
	let failures = 0;
	
	for (const [name, test] of tests) {
		const initial = `test ${name} ... `;
	
		try {
			await test();
			console.log(`${initial}%cok`, "color: green");
			successes += 1;
		} catch (e) {
			console.log(`${initial}%cFAILED`, "color: red");
			failures += 1;
			console.error(e);
		}
	}
	
	const details = `${successes} passed; ${failures} failed; finished in ${(Date.now() - start) / 1000}s`;
	
	if (failures !== 0) {
		console.log(`test result: %cFAILED%c. ${details}`, "color: red", "color: unset");
	} else {
		console.log(`test result: %cok%c. ${details}`, "color: green", "color: unset");
	}
}

export function assertEq<T extends Eq<U> & Debug, U extends Debug>(a: T, b: U): void {
	if (eq(a, b)) {
		return;
	}
	throw new Error(`equality assertion failed\n  left: ${debug(a)}\n right: ${debug(b)}`);
}

type Debug = { toString(): string; } | undefined;
function debug(v: Debug): string {
	if (v instanceof ArrayBuffer) {
		return `[${new Uint8Array(v).toString()}]`;
	} else if (typeof v === "undefined") {
		return "undefined";
	} else {
		return v.toString();
	}
}

export function assert<P extends MaybePromise<boolean>>(condition: () => P, reason?: string): MaybeThen<P, void> {
	return maybeThen(condition(), res => {
		if (res) {
			return;
		}
		if (reason === undefined) {
			reason = condition.toString();
			if (reason.startsWith("() => ")) {
				reason = reason.slice("() => ".length);
				reason = "`" + reason + "`";
			}
		}
		throw new Error(`assertion failed: ${reason}`);
	});
}

if (process.env.NODE_ENV !== "production") {
	globalThis.addEventListener("load", () => void runTests());
}
