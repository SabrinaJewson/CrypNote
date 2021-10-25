import { createEffect, createMemo, createSignal } from "solid-js";
import { JSX } from "solid-js";

import { Fading, FadingState } from "./fading";
import { base64UrlDecode, base64UrlEncode } from "../base64";
import { Bytes } from "../bytes";

import "./exportable.scss";

export function Exportable(props: { data: Bytes }): JSX.Element {
	const data = createMemo(() => base64UrlEncode(props.data));
	const overThreshold = createMemo(() => data().length > 1000);
	const copied = new FadingState();

	return <div class="exportable">
		{() => overThreshold()
			? <textarea value={data()} readonly rows={6} />
			: <pre>{data()}</pre>
		}
		<button type="button" onClick={() => {
			void (async () => {
				await navigator.clipboard.writeText(data());
				copied.show();
			})();
		}}>Click to copy</button>
		<Fading state={copied}>{<span> Copied!</span> as HTMLElement}</Fading>
	</div>;
}

export function Importable(props: { rows: number, setData: (data: Bytes) => void }): JSX.Element {
	const [encoded, setEncoded] = createSignal("");
	const [invalid, setInvalid] = createSignal(false);

	createEffect(() => {
		let bytes: Bytes;
		try {
			bytes = Bytes.buildWith(writer => base64UrlDecode(encoded(), writer));
		} catch (e) {
			setInvalid(true);
			return;
		}
		setInvalid(false);
		props.setData(bytes);
	});

	return <div class="importable">
		<textarea
			rows={props.rows}
			value={encoded()}
			classList={{ invalid: invalid() }}
			onInput={e => setEncoded((e.target as HTMLTextAreaElement).value)}
		/>
		<div><button type="button" onClick={() => setEncoded("")}>Clear</button></div>
	</div>;
}
