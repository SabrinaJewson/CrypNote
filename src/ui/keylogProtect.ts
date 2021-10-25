import { createEffect, untrack } from "solid-js";

import Keyboard, { KeyboardHandler } from "./keyboard";

interface Data {
	content: () => string,
	setContent: (v: string | ((old: string) => string)) => void,
	keyboard: () => Keyboard,
	enable: () => boolean,
	onTab?: () => void,
}

export function keylogProtect(
	element: HTMLElement & { value: string, selectionStart: number, selectionEnd: number },
	data: () => Data,
): void {
	const { content, setContent, keyboard, enable, onTab } = untrack(data);

	const handler: KeyboardHandler = {
		onBackspace: () => {
			const [start, end] = [element.selectionStart, element.selectionEnd];
			if (start === end) {
				if (start === 0) {
					return;
				}
				// TODO: Work using graphemes
				setContent(content => content.slice(0, start - 1) + content.slice(end));
				element.selectionStart = start - 1;
				element.selectionEnd = start - 1;
			} else {
				setContent(content => content.slice(0, start) + content.slice(end));
				element.selectionEnd = start;
			}
		},
		onInput: input => {
			const singleLine = element instanceof HTMLInputElement;

			if (input === "\n" && singleLine) {
				element.form?.requestSubmit();
			} else if (input === "\t" && onTab !== undefined) {
				element.blur();
				onTab();
			} else {
				if (singleLine) {
					input = input.replaceAll("\n", "");
				}
				const [start, end] = [element.selectionStart, element.selectionEnd];
				setContent(content => content.slice(0, start) + input + content.slice(end));
				element.selectionStart = start + input.length;
				element.selectionEnd = start + input.length;
			}
		},
	};

	createEffect(() => {
		element.value = content();
	});

	element.addEventListener("beforeinput", e => {
		// Prevent undo and redo because it doesn't work with the custom keyboard.
		if (enable() && (e.inputType === "insertText" || e.inputType === "historyUndo" || e.inputType === "historyRedo")) {
			e.preventDefault();
		}
	});
	element.addEventListener("input", () => setContent(element.value));
	element.addEventListener("focus", () => enable() && keyboard().show(handler));
	element.addEventListener("click", () => enable() && keyboard().show(handler));
	element.addEventListener("blur", () => {
		if (element !== document.activeElement) {
			keyboard().hide(handler);
		}
	});
}

declare module "solid-js" {
	namespace JSX {
		interface Directives {
			keylogProtect: Data,
		}
	}
}
