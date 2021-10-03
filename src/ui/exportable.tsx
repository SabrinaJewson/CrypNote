import { createEffect, createMemo, createSignal } from "solid-js";
import { JSX } from "solid-js";
import { Show } from "solid-js";

import { base64UrlDecode, base64UrlEncode } from "../base64";
import { Bytes } from "../bytes";

import "./exportable.scss";

export function Exportable(props: { data: Bytes }): JSX.Element {
	const data = createMemo(() => base64UrlEncode(props.data));

	return <div class="exportable">
		<pre>{data()}</pre>
		<CopyButton data={data()} />
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

function CopyButton(props: { data: string }): JSX.Element {
	enum CopiedState { Initial, Shown, Fading }
	type Copied = never
		| { state: CopiedState.Initial }
		| { state: CopiedState.Shown, timer: number }
		| { state: CopiedState.Fading };
	const [copied, setCopied] = createSignal<Copied>({ state: CopiedState.Initial });

	return <>
		<button type="button" onClick={() => {
			void (async () => {
				await navigator.clipboard.writeText(props.data);
				const timer = window.setTimeout(() => {
					setCopied({ state: CopiedState.Fading });
				}, 300);
				setCopied(old => {
					if (old.state === CopiedState.Shown) {
						window.clearTimeout(old.timer);
					}
					return { state: CopiedState.Shown, timer };
				});
			})();
		}}>Click to copy</button>
		<Show when={copied().state !== CopiedState.Initial}>
			<span
				classList={{ fade: copied().state === CopiedState.Fading }}
				onTransitionEnd={() => setCopied({ state: CopiedState.Initial })}
			> Copied!</span>
		</Show>
	</>;
}
