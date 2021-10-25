import { createMemo, onMount } from "solid-js";
import { JSX } from "solid-js";
import { keylogProtect } from "./keylogProtect";
false && keylogProtect; // Required to prevent dead-code elimination removing the above import

import Keyboard from "./keyboard";
import SyntheticTextBox from "./syntheticTextBox";

export default interface PasswordInput {
	readonly focus: () => boolean,
}

export default function(props: {
	label?: string,
	value: string,
	setValue: (v: string | ((old: string) => string)) => void,
	keylogged: boolean,
	scraped: boolean,
	keyboard: Keyboard,
	onTab: () => void,
	ref?: PasswordInput | ((controller: PasswordInput) => void),
}): JSX.Element {
	const memo = createMemo<{
		el: JSX.Element,
		scrolled: HTMLElement,
		focusable: HTMLElement | undefined,
	}>(old => {
		let el: JSX.Element;
		let scrolled: HTMLElement;
		let focusable: HTMLElement | undefined;

		if (props.scraped) {
			const canvas = <SyntheticTextBox
				content={props.value}
				setContent={props.setValue}
				padding={[1, 2]}
				discify
				fontFamily="Arial"
				keyboard={props.keylogged ? props.keyboard : undefined}
				onSubmit={() => {
					let form: HTMLElement | null = scrolled;
					do {
						form = form.parentElement;
					} while (!(form instanceof HTMLFormElement) && form !== null);
					form?.requestSubmit();
				}}
			/>;

			if (canvas instanceof HTMLCanvasElement) {
				focusable = canvas;
			}

			scrolled = <span class="passwordInputBox">{canvas}</span> as HTMLSpanElement;

			const Label = (props: { children: string }): JSX.Element => {
				return <span
					onClick={() => {
						if (canvas instanceof HTMLElement) {
							canvas.focus();
						}
					}}
				>
					{props.children}
				</span>;
			};

			el = <>
				{props.label && <Label>{props.label}</Label>}
				{scrolled}
			</>;
		} else {
			scrolled = <input
				type="password"
				class="passwordInputBox"
				use:keylogProtect={{
					content: () => props.value,
					setContent: props.setValue,
					keyboard: () => props.keyboard,
					enable: () => props.keylogged,
					onTab: props.onTab,
				}}
			/> as HTMLInputElement;
			focusable = scrolled;

			el = createMemo(() => {
				if (props.label === undefined) {
					return scrolled;
				} else {
					return <label>{props.label}{scrolled}</label>;
				}
			});
		}

		if (old !== undefined) {
			onMount(() => scrolled.scrollLeft = old.scrolled.scrollLeft);
		}

		return { el, scrolled, focusable };
	});

	const controller = {
		focus: () => {
			const focusable = memo().focusable;
			if (focusable === undefined) {
				return false;
			} else {
				focusable.focus();
				return true;
			}
		},
	};
	if (typeof props.ref === "function") {
		props.ref(controller);
	}

	return () => memo().el;
}
