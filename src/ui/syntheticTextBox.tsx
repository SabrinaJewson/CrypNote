import Keyboard, { KeyboardHandler } from "./keyboard";
import { batch, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { JSX } from "solid-js";
import graphemeSplit from "graphemesplit";
import { LineBreaker as lineBreaker } from "css-line-break";

import { addSelectAllListener, removeSelectAllListener } from "../onSelectAll";

// We can't support `overflow-wrap: break-word` because implementing it would require being able to
// directly set a canvas intrinsic's CSS size which is not possible. `normal` and `anywhere` are
// both possible because we can emulate setting its intrinsic size by setting its `min-width` -
// since the text box would overflow anyway if it were smaller than the intrinsic size, behaviour
// is nearly identical. In other words, only `overflow-wrap: break-word` causes text boxes to have
// an intrinsic size that is greater than its minimum size.
export enum OverflowWrap { Normal, Anywhere }

type WrappingProps = { textWrap: true, overflowWrap?: OverflowWrap }
	| { textWrap?: false, onSubmit?: () => void };

const DISC = "•";

export default function(props: {
	content: string,
	setContent?: (v: string | ((old: string) => string)) => void,
	padding?: number | [number, number],
	fontSize?: number,
	fontFamily?: string,
	discify?: boolean,
	keyboard?: Keyboard,
} & WrappingProps): HTMLCanvasElement | JSX.Element {
	const [selected, setSelected] = createSignal({ start: 0, end: 0 });

	// Size of the canvas in CSS pixels
	const [cssWidth, setCssWidth] = createSignal(0);
	const [cssHeight, setCssHeight] = createSignal(0);
	// Size of the canvas in device pixels
	const [deviceWidth, setDeviceWidth] = createSignal(0);
	const [deviceHeight, setDeviceHeight] = createSignal(0);

	const padding = createMemo(() => {
		let padding: { top: number, right: number, bottom: number, left: number };
		if (props.padding === undefined || typeof props.padding === "number") {
			const value = props.padding ?? 0;
			padding = { top: value, right: value, bottom: value, left: value };
		} else {
			const [y, x] = props.padding;
			padding = { top: y, right: x, bottom: y, left: x };
		}

		const dpr = devicePixelRatio();
		const top = padding.top * dpr;
		const right = padding.right * dpr;
		const bottom = padding.bottom * dpr;
		const left = padding.left * dpr;
		return { top, right, bottom, left, x: right + left, y: top + bottom };
	});

	const canvas = <canvas
		class="syntheticTextBox"
		width={deviceWidth()}
		height={deviceHeight()}
		tabIndex={props.setContent && 0}
	/> as HTMLCanvasElement;
	const cx = canvas.getContext("2d");
	if (cx === null) {
		return <>Failed to set up renderer.</>;
	}

	let observer: ResizeObserver;
	if ("devicePixelContentBoxSize" in ResizeObserverEntry.prototype) {
		observer = new ResizeObserver(([entry]) => {
			const cssSize = valueOrFirst(entry.contentBoxSize);
			setCssWidth(cssSize.inlineSize);
			setCssHeight(cssSize.blockSize);

			const deviceSize = valueOrFirst(entry.devicePixelContentBoxSize);
			setDeviceWidth(deviceSize.inlineSize);
			setDeviceHeight(deviceSize.blockSize);
		});
	} else {
		observer = new ResizeObserver(([entry]) => {
			const cssSize = valueOrFirst(entry.contentBoxSize);
			setCssWidth(cssSize.inlineSize);
			setCssHeight(cssSize.blockSize);
		});
		// Fall back to rounding based on device pixel ratio. This does not work always:
		//
		// > The device-pixel-content-box can be approximated by multiplying devicePixelRatio by
		// > the content-box size. However, due to browser-specific subpixel snapping behavior,
		// > authors cannot determine the correct way to round this scaled content-box size. How a
		// > UA computes the device pixel box for an element is implementation-dependent.
		//
		// <https://www.w3.org/TR/resize-observer/#resize-observer-interface>
		createEffect(() => setDeviceWidth(Math.round(cssWidth() * devicePixelRatio())));
		createEffect(() => setDeviceHeight(Math.round(cssHeight() * devicePixelRatio())));
	}
	observer.observe(canvas);

	onMount(() => {
		const fontMetrics = createMemo(() => {
			const fontSize = props.fontSize ?? 13 * devicePixelRatio();
			const font = `${fontSize}px ${props.fontFamily ?? "monospace"}`;
			const lineHeight = Math.floor(1.2 * fontSize);
			cx.font = font;

			const spaceMetrics = cx.measureText(" ");
			const selectedNewlineWidth = spaceMetrics.width;
			const tabWidth = spaceMetrics.width * 8;

			// If `fontBoudingBox{Ascent, Descent}` is not supported, we fall back to measuring
			// the actual bounding box of characters that (on my font) have a bounding box very
			// close to that of the font's.
			const ascent = spaceMetrics.fontBoundingBoxAscent
				?? cx.measureText("Ã").actualBoundingBoxAscent;
			const descent = spaceMetrics.fontBoundingBoxDescent
				?? Math.round(cx.measureText("ଡ଼").actualBoundingBoxDescent);

			return { font, fontSize, lineHeight, selectedNewlineWidth, tabWidth, ascent, descent };
		});
		const layout: () => Layout = createMemo(() => {
			const { font, lineHeight, selectedNewlineWidth, tabWidth, ascent, descent } = fontMetrics();
			const padding_ = padding();

			cx.font = font;

			// A final empty grapheme is always added to the end of this array. It simplifies lots
			// of code by:
			// - Making selected indices always in-bounds: when the selection goes until the end of
			// the text, we can access the empty grapheme's `stringIndex`, `row` and `x` properties
			// just like any other grapheme's.
			// - Allowing clicking beyond the end of a line to consistently select the last
			// character of the line: this is generally whitespace, a newline or the empty grapheme.
			const graphemes: Grapheme[] = [];
			const rows: number[] = [];
			let minWidth: number;
			let minHeight: number;

			if (props.textWrap) {
				const wrapper = new WordWrapper(Math.max(deviceWidth() - padding_.x, 0));
				let stringIndex = 0;
				const lines = { [Symbol.iterator]: () => lineBreaker(props.content) };
				minWidth = 0;
				for (const line of lines) {
					const content = line.slice();
					if (props.overflowWrap !== OverflowWrap.Anywhere) {
						const contentWidth = cx.measureText(content).width;
						minWidth = Math.max(minWidth, contentWidth);
					}

					const box = content.trimEnd();
					const boxWidth = cx.measureText(box).width;

					if (props.overflowWrap === OverflowWrap.Anywhere && boxWidth > wrapper.width) {
						for (const grapheme of graphemeSplit(box)) {
							const width = cx.measureText(grapheme).width;
							const { x, row } = wrapper.box(width);
							rows[row] ??= graphemes.length;
							graphemes.push({ content: grapheme, stringIndex, row, x, width });
							stringIndex += grapheme.length;
							minWidth = Math.max(minWidth, width);
						}
					} else {
						const { x: startX, row } = wrapper.box(boxWidth);
						rows[row] ??= graphemes.length;
						let x = startX;
						for (const grapheme of graphemeSplit(box)) {
							const width = cx.measureText(grapheme).width;
							graphemes.push({ content: grapheme, stringIndex, row, x, width });
							x += width;
							stringIndex += grapheme.length;
							minWidth = Math.max(minWidth, width);
						}
					}

					const row = wrapper.row;

					for (const grapheme of graphemeSplit(content.slice(box.length))) {
						if (grapheme === "\n") {
							graphemes.push({ stringIndex, row, x: wrapper.x, width: selectedNewlineWidth });
							wrapper.newline();
						} else {
							const width = grapheme === "\t"
								? Math.floor(wrapper.x / tabWidth) * tabWidth + tabWidth - wrapper.x
								: cx.measureText(grapheme).width;
							graphemes.push({ stringIndex, row, x: wrapper.x, width });
							wrapper.glue(width);
						}
						stringIndex += grapheme.length;
					}
				}
				graphemes.push({ stringIndex, row: wrapper.row, x: wrapper.x, width: 0 });

				minHeight = ascent + lineHeight * wrapper.row + descent;
			} else {
				let stringIndex = 0;
				let x = 0;

				rows[0] = 0;

				for (const originalGrapheme of graphemeSplit(props.content)) {
					const grapheme = props.discify ? DISC : originalGrapheme;

					const width = grapheme === "\t"
						? Math.floor(x / tabWidth) * tabWidth + tabWidth - x
						: cx.measureText(grapheme).width;
					graphemes.push({ stringIndex, content: grapheme, row: 0, x, width });
					x += width;
					stringIndex += originalGrapheme.length;
				}
				graphemes.push({ stringIndex, row: 0, x, width: 0 });

				minWidth = x;
				minHeight = ascent + descent;
			}

			canvas.style.minWidth = `${(padding_.x + Math.ceil(minWidth)) / devicePixelRatio()}px`;
			canvas.style.minHeight = `${(padding_.y + minHeight) / devicePixelRatio()}px`;

			return { graphemes, rows };
		});

		const sliceContent = (start?: number, end?: number): string => {
			const { graphemes } = layout();
			return props.content.slice(
				start && graphemes[start]?.stringIndex,
				end && graphemes[end]?.stringIndex,
			);
		};

		const [windowFocused, setWindowFocused] = createSignal(true);
		const [focused, setFocused] = createSignal(false);

		const [cursorFlash, setCursorFlash] = createSignal(false);
		let cursorFlashTimeout: number | undefined;
		createEffect(() => {
			if (cursorFlashTimeout !== undefined) {
				window.clearTimeout(cursorFlashTimeout);
			}
			cursorFlash();
			cursorFlashTimeout = window.setTimeout(() => setCursorFlash(flash => !flash), 500);
		});
		createEffect(() => {
			selected();
			setCursorFlash(true);
		});

		const displayCursor = createMemo(() => {
			return focused() && windowFocused() && cursorFlash() && selected().start === selected().end;
		});

		createEffect(() => {
			const { font, lineHeight, ascent, descent } = fontMetrics();
			const selected_ = selected();
			const padding_ = padding();
			const graphemes = layout().graphemes;

			cx.clearRect(0, 0, deviceWidth(), deviceHeight());

			for (const [i, grapheme] of graphemes.entries()) {
				const x = padding_.left + grapheme.x;
				const y = padding_.top + ascent + lineHeight * grapheme.row;

				let textColor: string;
				if (
					i >= selected_.start && i < selected_.end
					|| i >= selected_.end && i < selected_.start
				) {
					if (windowFocused()) {
						cx.fillStyle = "#338FFF";
						textColor = "white";
					} else {
						cx.fillStyle = "#C8C8C8";
						textColor = "#323232";
					}
					cx.fillRect(Math.floor(x), y - ascent, grapheme.width + 1, lineHeight);
				} else {
					textColor = "black";
				}

				if (grapheme.content !== undefined) {
					cx.fillStyle = textColor;
					cx.font = font;
					cx.fillText(grapheme.content, x, y);
				}
			}

			if (displayCursor()) {
				const grapheme = graphemes[selected_.start];
				cx.fillStyle = "black";
				cx.fillRect(
					Math.round(padding_.left + grapheme.x) || 1,
					padding_.top + lineHeight * grapheme.row,
					1,
					ascent + descent,
				);
			}
		});

		const deleteSelected = (): void => {
			const { start, end } = normalizeSelection(selected());
			batch(() => {
				props.setContent!(sliceContent(0, start) + sliceContent(end));
				setSelected({ start, end: start });
			});
		};

		const backspace = (): void => {
			const { start, end } = selected();
			if (start !== end) {
				deleteSelected();
			} else if (start !== 0) {
				batch(() => {
					props.setContent!(sliceContent(0, start - 1) + sliceContent(start));
					setSelected({ start: start - 1, end: start - 1 });
				});
			}
		};

		const insert = (text: string): void => batch(() => {
			if (props.setContent === undefined) {
				return;
			}
			const { start, end } = normalizeSelection(selected());
			props.setContent(sliceContent(0, start) + text + sliceContent(end));
			const cursor = start + graphemeSplit(text).length;
			setSelected({ start: cursor, end: cursor });
		});

		canvas.addEventListener("keydown", e => {
			if (props.setContent === undefined) {
				// Shouldn't be able to happen anyway because `tabindex` isn't set.
				return;
			}

			let preventDefault = true;
			switch (e.key) {
				case "Backspace": { backspace(); break; }
				case "Delete": {
					const { start, end } = normalizeSelection(selected());
					if (start !== end) {
						deleteSelected();
					} else if (start + 1 < layout().graphemes.length) {
						props.setContent(sliceContent(0, start) + sliceContent(start + 1));
					}
					break;
				}
				case "Clear": {
					batch(() => {
						props.setContent!("");
						setSelected({ start: 0, end: 0 });
					});
					break;
				}
				case "ArrowLeft": {
					const { start, end } = normalizeSelection(selected());
					if (start !== end) {
						setSelected({ start, end: start });
					} else if (start !== 0) {
						setSelected({ start: start - 1, end: start - 1 });
					}
					break;
				}
				case "ArrowRight": {
					const { start, end } = normalizeSelection(selected());
					if (start !== end) {
						setSelected({ start: end, end });
					} else if (end + 1 < layout().graphemes.length) {
						setSelected({ start: end + 1, end: end + 1 });
					}
					break;
				}
				case "ArrowUp": {
					const { start } = normalizeSelection(selected());
					const layout_ = layout();
					const { row, x } = layout_.graphemes[start];
					if (row === 0) {
						setSelected({ start: 0, end: 0 });
					} else {
						const { index } = graphemeInRow(layout_, row - 1, x);
						setSelected({ start: index, end: index });
					}
					break;
				}
				case "ArrowDown": {
					const { end } = normalizeSelection(selected());
					const layout_ = layout();
					const { row, x } = layout_.graphemes[end];
					const maxCursor = layout_.graphemes.length - 1;
					if (row >= maxCursor) {
						setSelected({ start: maxCursor, end: maxCursor });
					} else {
						const { index } = graphemeInRow(layout_, row + 1, x);
						setSelected({ start: index, end: index });
					}
					break;
				}
				case "Home": {
					setSelected({ start: 0, end: 0 });
					break;
				}
				case "End": {
					const cursor = layout().graphemes.length - 1;
					setSelected({ start: cursor, end: cursor });
					break;
				}
				case "Enter": {
					if (props.textWrap) {
						insert("\n");
					} else {
						props.onSubmit?.();
						preventDefault = false;
					}
					break;
				}
				case "Tab": {
					if (props.textWrap) {
						insert("\t");
					} else {
						preventDefault = false;
					}
					break;
				}
				default: {
					if (
						e.key !== ""
						&& !e.ctrlKey
						&& props.keyboard === undefined
						&& graphemeSplit(e.key).length === 1
					) {
						insert(e.key);
					} else {
						preventDefault = false;
					}
					break;
				}
			}
			if (preventDefault) {
				e.preventDefault();
			}
		});

		const keyboardHandler: KeyboardHandler = {
			onBackspace: backspace,
			onInput: input => {
				if (!props.textWrap && input === "\n") {
					props.onSubmit?.();
				} else {
					insert(input);
				}
			},
		};

		interface LocatedGrapheme {
			i: number,
			strict: boolean,
		}
		const graphemeAt = (x: number, y: number): LocatedGrapheme => {
			const { lineHeight } = fontMetrics();
			const layout_ = layout();
			const padding_ = padding();

			x *= devicePixelRatio();
			y *= devicePixelRatio();

			x -= padding_.left;
			y -= padding_.top;

			if (y < 0) {
				return { i: 0, strict: false };
			}
			const row = Math.floor(y / lineHeight);
			if (row >= layout_.rows.length) {
				return { i: layout_.graphemes.length - 1, strict: false };
			}

			const { found, index } = graphemeInRow(layout_, row, x);
			return { i: index, strict: found };
		};

		canvas.addEventListener("pointerdown", e => {
			if (e.button !== 0) {
				return;
			}
			const i = graphemeAt(e.offsetX, e.offsetY).i;
			setSelected({ start: i, end: i });
			getSelection()?.removeAllRanges();
			canvas.setPointerCapture(e.pointerId);
			props.keyboard?.show(keyboardHandler);
		});
		canvas.addEventListener("pointermove", e => {
			let cachedGrapheme: LocatedGrapheme | undefined;
			const grapheme = (): LocatedGrapheme => cachedGrapheme ??= graphemeAt(e.offsetX, e.offsetY);

			if (props.setContent !== undefined || grapheme().strict) {
				canvas.style.cursor = "text";
			} else {
				canvas.style.cursor = "";
			}

			if (canvas.hasPointerCapture(e.pointerId)) {
				setSelected(old => ({ start: old.start, end: grapheme().i }));
			}
		});
		canvas.addEventListener("focus", () => {
			setFocused(true);
			props.keyboard?.show(keyboardHandler);
		});
		canvas.addEventListener("blur", () => {
			if (document.activeElement === canvas) {
				return;
			}
			setFocused(false);
			props.keyboard?.hide(keyboardHandler);
		});

		const onSelectStart = (e: Event): void => {
			if (e.target !== canvas) {
				setSelected({ start: 0, end: 0 });
			}
		};
		const onFocus = (): void => {
			setWindowFocused(true);
		};
		const onBlur = (): void => {
			setWindowFocused(false);
		};
		const onCut = (e: ClipboardEvent): void => {
			const { start, end } = normalizeSelection(selected());
			if (focused() && !props.discify && start !== end && props.setContent !== undefined) {
				e.clipboardData?.setData("text/plain", sliceContent(start, end));
				props.setContent(sliceContent(0, start) + sliceContent(end));
				setSelected({ start, end: start });
				e.preventDefault();
			}
		};
		const onCopy = (e: ClipboardEvent): void => {
			const { start, end } = normalizeSelection(selected());
			if (focused() && !props.discify && start !== end) {
				e.clipboardData?.setData("text/plain", sliceContent(start, end));
				e.preventDefault();
			}
		};
		const onPaste = (e: ClipboardEvent): void => {
			if (focused() && e.clipboardData !== null) {
				insert(e.clipboardData.getData("text/plain"));
				e.preventDefault();
			}
		};
		const onSelectAll = (): boolean | void => {
			if (focused()) {
				setSelected({
					start: 0,
					end: layout().graphemes.length - 1,
				});
				return false;
			}
		}
		addEventListener("selectstart", onSelectStart);
		addEventListener("focus", onFocus);
		addEventListener("blur", onBlur);
		addEventListener("cut", onCut);
		addEventListener("copy", onCopy);
		addEventListener("paste", onPaste);
		addSelectAllListener(onSelectAll);
		onCleanup(() => {
			removeEventListener("selectstart", onSelectStart);
			removeEventListener("focus", onFocus);
			removeEventListener("blur", onBlur);
			removeEventListener("cut", onCut);
			removeEventListener("copy", onCopy);
			removeEventListener("paste", onPaste);
			removeSelectAllListener(onSelectAll);
		});
	});

	return canvas;
}

class WordWrapper {
	x: number;
	row: number;

	constructor(public width: number) {
		this.x = 0;
		this.row = 0;
	}

	box(width: number): { x: number, row: number } {
		if (this.x !== 0 && this.x + width > this.width) {
			this.x = 0;
			this.row += 1;
		}
		const coord = { x: this.x, row: this.row };
		this.x += width;
		return coord;
	}

	glue(width: number): void {
		this.x += width;
	}

	newline(): void {
		this.x = Infinity;
	}
}

interface Selection {
	start: number,
	end: number,
}

function normalizeSelection(selection: Selection): Selection {
	return {
		start: Math.min(selection.start, selection.end),
		end: Math.max(selection.start, selection.end),
	};
}

interface Layout {
	readonly graphemes: readonly Grapheme[],
	// Indices in `graphemes` of each row start.
	readonly rows: readonly number[],
}

interface Grapheme {
	// The content of the grapheme. `undefined` if the grapheme is whitespace.
	readonly content?: string,
	readonly stringIndex: number,
	// The row the grapheme is on.
	readonly row: number,
	// The x position of the grapheme in canvas pixels, not including padding.
	readonly x: number,
	// The width of the grapheme in canvas pixels.
	readonly width: number,
}

function graphemeInRow(layout: Layout, row: number, x: number): { found: boolean, index: number } {
	const rowStart = layout.rows[row];
	const rowEnd = layout.rows[row + 1] ?? layout.graphemes.length;
	const { found, index } =  binarySearch(layout.graphemes, rowStart, rowEnd, grapheme => {
		if (x < grapheme.x) {
			return -1;
		} else if (x >= grapheme.x + grapheme.width) {
			return 1;
		} else {
			return 0;
		}
		// Alternative algorithm:
		// return Math.floor((x - grapheme.x) / grapheme.width);
	});
	if (!found) {
		return { found: false, index: index === 0 ? 0 : rowEnd - 1 };
	} else {
		const grapheme = layout.graphemes[index];
		if (index + 1 < rowEnd && x > grapheme.x + grapheme.width/2) {
			return { found: true, index: index + 1 };
		} else {
			return { found: true, index };
		}
	}
}

const devicePixelRatio = (() => {
	const [dpr, setDpr] = createSignal(window.devicePixelRatio);

	const updater = (): void => {
		const pr = window.devicePixelRatio;
		setDpr(pr);
		matchMedia(`(resolution: ${pr}dppx)`).addEventListener("change", updater, { once: true });
	};
	updater();

	return dpr;
})();

function valueOrFirst<T>(v: T): T extends ArrayLike<infer U> ? U : T {
	if (Array.isArray(v)) {
		return v[0] as T extends ArrayLike<infer U> ? U : T;
	} else {
		return v as T extends ArrayLike<infer U> ? U : T;
	}
}

function binarySearch<T>(
	items: readonly T[],
	searchingFrom: number,
	searchingTo: number,
	f: (item: T) => number,
): { found: boolean, index: number } {
	while (searchingFrom < searchingTo) {
		const mid = searchingFrom + ((searchingTo - searchingFrom) >>> 1);
		const compared = f(items[mid]);
		if (compared < 0) {
			searchingTo = mid;
		} else if (compared > 0) {
			searchingFrom = mid + 1;
		} else {
			return { found: true, index: mid };
		}
	}
	return { found: false, index: searchingFrom };
}
