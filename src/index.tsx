import App from "./ui";
import { render } from "solid-js/web";

render(App, document.getElementById("app")!);

export function exhausted(_: never): void {
	throw new Error("Entered unreachable code");
}

declare global {
	interface SubtleCrypto {
		// typescript types the return types as `any` for some reason; correct that.
		decrypt(algorithm: AlgorithmIdentifier | AesGcmParams, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>;
		encrypt(algorithm: AlgorithmIdentifier | AesGcmParams, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>;
	}
}
