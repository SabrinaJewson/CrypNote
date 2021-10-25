import { JSX } from "solid-js";
import { Show } from "solid-js";

import { runTests } from "../test";

export default interface Settings {
	readonly keylogged: () => boolean,
	readonly setKeylogged: (v: boolean | ((old: boolean) => boolean)) => void,
	readonly scraped: () => boolean,
	readonly setScraped: (v: boolean | ((old: boolean) => boolean)) => void,
}

export default function(props: { settings: Settings }): JSX.Element {
	return <>
		<h1>Settings</h1>
		<p>These settings are applied globally and independent of which account you use.</p>

		<p><label>
			Enable keylogger protection:
			<input
				type="checkbox"
				checked={props.settings.keylogged()}
				onInput={e => props.settings.setKeylogged((e.target as HTMLInputElement).checked)}
			/>
		</label></p>
		<p>
			This option thwarts keyloggers by preventing you from typing potentially sensitive
			information (passwords, encrypted messages) via the system keyboard, instead enforcing
			that it happens via a keyboard implemented in software.
		</p>

		<p><label>
			Enable scraper protection:
			<input
				type="checkbox"
				checked={props.settings.scraped()}
				onInput={e => props.settings.setScraped((e.target as HTMLInputElement).checked)}
			/>
		</label></p>
		<p>
			This option thwarts screen scrapers by displaying all potentially sensitive information
			(passwords, decrypted messages, messages about to be encrypted) through a canvas instead
			of natively. This makes it extremely difficult for any third-party Javascript running on
			this page (such as through a tracking browser extension) to decipher what is written.
		</p>

		<Show when={process.env.NODE_ENV !== "production"}>
			<button type="button" onClick={() => void runTests()}>Run tests</button>
		</Show>
	</>;
}
