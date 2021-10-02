import { Bytes, BytesMut } from "./bytes";
import { assertEq, test } from "./test";

export function base64Encode(buffer: Iterable<number>): string {
	let base64 = window.btoa(String.fromCharCode(...buffer));
	const paddingStart = base64.indexOf("=");
	if (paddingStart !== -1) {
		base64 = base64.slice(0, paddingStart);
	}
	return base64;
}

export function base64Decode(base64: string, writer: BytesMut): void {
	const s = window.atob(base64);
	writer.reserve(s.length);
	for (const c of s) {
		writer.push(c.charCodeAt(0));
	}
}

export function base64UrlEncode(buffer: Iterable<number>): string {
	return base64Encode(buffer).replaceAll("/", "_").replaceAll("+", "-");
}

export function base64UrlDecode(base64: string, writer: BytesMut): void {
	return base64Decode(base64.replaceAll("-", "+").replaceAll("_", "/"), writer);
}

test("base64", () => {
	assertEq(base64Encode([]), "");
	assertEq(base64Encode([1, 2, 3]), "AQID");

	function decode(base64: string): Bytes {
		return Bytes.buildWith(writer => base64Decode(base64, writer));
	}
	assertEq(decode(""), []);
	assertEq(decode("AQID"), [1, 2, 3]);
});
