// On-screen keyboard

import { createMemo, createSignal } from "solid-js";
import { For } from "solid-js";
import { JSX } from "solid-js";

import { test } from "../test";

import "./keyboard.scss";

interface Key {
	width: number,
	normal: KeyState,
	shift: KeyState,
	alt: KeyState,
	altShift: KeyState,
}

interface KeyState {
	display: string,
	function: string | Special,
}

enum Special {
	CapsLock,
	Shift,
	Alt,
	Close,
	Bottom,
}

function buildLayout(layout: {
	width: number,
	normal: string | KeyState,
	shift?: string | KeyState,
	alt?: string | KeyState,
	altShift?: string | KeyState,
}[][]): Key[][] {
	function buildKeyState(state: string | KeyState): KeyState {
		if (typeof state === "string") {
			return { display: state, function: state };
		} else {
			return state;
		}
	}

	return layout.map(row => row.map(key => ({
		width: key.width,
		normal: buildKeyState(key.normal),
		shift: buildKeyState(key.shift ?? key.normal),
		alt: buildKeyState(key.alt ?? key.normal),
		altShift: buildKeyState(key.altShift ?? key.alt ?? key.shift ?? key.normal),
	})));
}

const layout: Key[][] = buildLayout([
	[
		{ width: 1, normal: "`", shift: "¬" },
		{ width: 1, normal: "1", shift: "!" },
		{ width: 1, normal: "2", shift: "\"" },
		{ width: 1, normal: "3", shift: "£" },
		{ width: 1, normal: "4", shift: "$", alt: "€", altShift: "¢" },
		{ width: 1, normal: "5", shift: "%" },
		{ width: 1, normal: "6", shift: "^" },
		{ width: 1, normal: "7", shift: "&" },
		{ width: 1, normal: "8", shift: "*" },
		{ width: 1, normal: "9", shift: "(" },
		{ width: 1, normal: "0", shift: ")" },
		{ width: 1, normal: "-", shift: "_" },
		{ width: 1, normal: "=", shift: "+" },
		{ width: 2, normal: { display: "⌫", function: "\x08" } },
	],
	[
		{ width: 1.5, normal: "Steve" },
		{ width: 1, normal: "q", shift: "Q" },
		{ width: 1, normal: "w", shift: "W" },
		{ width: 1, normal: "e", shift: "E" },
		{ width: 1, normal: "r", shift: "R" },
		{ width: 1, normal: "t", shift: "T" },
		{ width: 1, normal: "y", shift: "Y" },
		{ width: 1, normal: "u", shift: "U" },
		{ width: 1, normal: "i", shift: "I" },
		{ width: 1, normal: "o", shift: "O" },
		{ width: 1, normal: "p", shift: "P" },
		{ width: 1, normal: "[", shift: "{" },
		{ width: 1, normal: "]", shift: "}" },
		{ width: 1.5, normal: { display: "if err != nil", function: `if err != nil {\n	return nil, err\n}\n` } },
	],
	[
		{ width: 1.75, normal: { display: "⇪", function: Special.CapsLock } },
		{ width: 1, normal: "a", shift: "A" },
		{ width: 1, normal: "s", shift: "S" },
		{ width: 1, normal: "d", shift: "D" },
		{ width: 1, normal: "f", shift: "F" },
		{ width: 1, normal: "g", shift: "G" },
		{ width: 1, normal: "h", shift: "H" },
		{ width: 1, normal: "j", shift: "J" },
		{ width: 1, normal: "k", shift: "K" },
		{ width: 1, normal: "l", shift: "L" },
		{ width: 1, normal: ";", shift: ":" },
		{ width: 1, normal: "'", shift: "@" },
		{ width: 1, normal: "#", shift: "~" },
		{ width: 1.25, normal: { display: "↵", function: "\n" } },
	],
	[
		{ width: 1.25, normal: { display: "⇧", function: Special.Shift } },
		{ width: 1, normal: "\\", shift: "|" },
		{ width: 1, normal: "z", shift: "Z" },
		{ width: 1, normal: "x", shift: "X" },
		{ width: 1, normal: "c", shift: "C" },
		{ width: 1, normal: "v", shift: "V" },
		{ width: 1, normal: "b", shift: "B" },
		{ width: 1, normal: "n", shift: "N" },
		{ width: 1, normal: "m", shift: "M" },
		{ width: 1, normal: ",", shift: "<" },
		{ width: 1, normal: ".", shift: ">" },
		{ width: 1, normal: "/", shift: "?" },
		{ width: 2.75, normal: { display: "⇧", function: Special.Shift } },
	],
	[
		{ width: 1.25, normal: { display: "✨", function: Special.Bottom } },
		{ width: 1.25, normal: "😀" },
		{ width: 1.25, normal: { display: "⎇", function: Special.Alt } },
		{ width: 6.25, normal: " " },
		{ width: 1.25, normal: { display: "⎇", function: Special.Alt } },
		{ width: 3.75, normal: { display: "↧", function: Special.Close } },
	],
]);

test("keyboard row widths are equal", () => {
	const width = layout[0].reduce((acc, key) => acc + key.width, 0);
	for (const [i, row] of layout.entries()) {
		const w = row.reduce((acc, key) => acc + key.width, 0);
		if (w !== width) {
			console.error(`Row ${i}: expected width of ${width}, found width of ${w}`);
		}
	}
});

enum ShiftMode {
	Normal,
	Shift,
	CapsLock,
}

export default function(props: {
	onInput: (key: string) => void,
	onClose: () => void,
}): JSX.Element {
	const [shiftMode, setShiftMode] = createSignal(ShiftMode.Normal);
	const [altMode, setAltMode] = createSignal(false);

	addEventListener("keydown", e => {
		if (e.key === "Shift") {
			setShiftMode(ShiftMode.Shift);
		} else if (e.key === "Alt") {
			setAltMode(true);
		}
	});
	addEventListener("keyup", e => {
		if (e.key === "Shift") {
			setShiftMode(ShiftMode.Normal);
		} else if (e.key === "Alt") {
			setAltMode(false);
		}
	});

	return <div
		class="keyboard"
		// Prevent clicking defocusing existing focused elements
		onMouseDown={e => e.preventDefault()}
	>
		<For each={layout}>{row => <div><For each={row}>{key => {
			const state = createMemo(() => {
				const shift = shiftMode() !== ShiftMode.Normal;
				const alt = altMode();
				return shift ? (alt ? key.altShift : key.shift) : (alt ? key.alt : key.normal);
			});

			const held = createMemo(() => {
				return (false
					|| state().function === Special.Shift && shiftMode() === ShiftMode.Shift
					|| state().function === Special.CapsLock && shiftMode() === ShiftMode.CapsLock
					|| state().function === Special.Alt && altMode()
				);
			});

			const onClick = (e: MouseEvent): void => {
				const func = state().function;
				switch (func) {
					case Special.CapsLock: {
						setShiftMode(mode => (
							mode === ShiftMode.CapsLock ? ShiftMode.Normal : ShiftMode.CapsLock
						));
						break;
					}
					case Special.Shift: {
						setShiftMode(mode => (
							mode === ShiftMode.Normal ? ShiftMode.Shift : ShiftMode.Normal
						));
						break;
					}
					case Special.Alt: {
						setAltMode(mode => !mode);
						break;
					}
					case Special.Bottom: {
						const messages = [
							"👉👈",
							"💖",
							"🥺",
							"✨",
							",,",
							"🫂",
						];
						const message = messages[Math.floor(Math.random() * messages.length)];
						props.onInput(message);
						break;
					}
					case Special.Close: {
						props.onClose();
						break;
					}
					default: {
						props.onInput(func);
						setAltMode(e.altKey);
						if (e.shiftKey) {
							setShiftMode(ShiftMode.Shift);
						} else if (shiftMode() === ShiftMode.Shift) {
							setShiftMode(ShiftMode.Normal);
						}
					}
				}
			};

			const onDblClick = (): void => {
				if (state().function === Special.Shift) {
					setShiftMode(mode => (
						mode === ShiftMode.CapsLock ? ShiftMode.Normal : ShiftMode.CapsLock
					));
				}
			};

			return <div class="key" style={`flex: ${key.width} 0 ${key.width}px`}>
				<div
					onClick={onClick}
					onDblClick={onDblClick}
					classList={{ held: held() }}
				>
					{state().display}
				</div>
			</div>;
		}}</For></div>}</For>
	</div>;
}
