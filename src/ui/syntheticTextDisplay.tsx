import { batch, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { JSX } from "solid-js";
import graphemeSplit from "graphemesplit";
import { LineBreaker as lineBreaker } from "css-line-break";

import { addSelectAllListener, removeSelectAllListener } from "../onSelectAll";

export enum OverflowWrap { Normal, BreakWord }

export interface SyntheticTextDisplay {
	readonly backspace: () => void,
	readonly delete: () => void,
	readonly clear: () => void,
	readonly insert: (text: string) => void,
	readonly left: () => void,
	readonly right: () => void,
	readonly up: () => void,
	readonly down: () => void,
	readonly home: () => void,
	readonly end: () => void,
}

export function SyntheticTextDisplay(props: {
	content: string,
	setContent?: (v: string | ((old: string) => string)) => void,
	padding?: number,
	overflowWrap?: OverflowWrap,
	onFocus?: () => void,
	onBlur?: () => void,
	ref?: SyntheticTextDisplay | ((controller: SyntheticTextDisplay) => void),
}): JSX.Element {
	const [selected, setSelected] = createSignal({ start: 0, end: 0 });

	// Size of the canvas in CSS pixels
	const [cssWidth, setCssWidth] = createSignal(0);
	const [cssHeight, setCssHeight] = createSignal(0);
	// Size of the canvas in device pixels
	const [deviceWidth, setDeviceWidth] = createSignal(0);
	const [deviceHeight, setDeviceHeight] = createSignal(0);

	const padding = createMemo(() => (props.padding ?? 0) * devicePixelRatio());

	const canvas = <canvas
		class="syntheticTextDisplay"
		width={deviceWidth()}
		height={deviceHeight()}
		tabIndex={props.setContent && 0}
	/> as HTMLCanvasElement;
	const cx = canvas.getContext("2d");
	if (cx === null) {
		return <p>Failed to set up renderer.</p>;
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
		const baseMetrics = createMemo(() => {
			const fontSize = 13 * devicePixelRatio();
			const lineHeight = Math.floor(1.2 * fontSize);
			cx.font = `${fontSize}px monospace`;

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

			return { fontSize, lineHeight, selectedNewlineWidth, tabWidth, ascent, descent };
		});
		const layout: () => Layout = createMemo(() => {
			const { fontSize, lineHeight, selectedNewlineWidth, tabWidth, ascent, descent } = baseMetrics();
			const padding_ = padding();

			cx.font = `${fontSize}px monospace`;

			const graphemes: Grapheme[] = [];
			const rows: number[] = [];

			const wrapper = new WordWrapper(Math.max(deviceWidth() - padding_ * 2, 0));
			let stringIndex = 0;
			const lines = { [Symbol.iterator]: () => lineBreaker(props.content + "\n") };
			for (const line of lines) {
				const content = line.slice();

				const box = content.trimEnd();
				const boxWidth = cx.measureText(box).width;

				if (props.overflowWrap === OverflowWrap.BreakWord && boxWidth > wrapper.width) {
					for (const grapheme of graphemeSplit(box)) {
						const width = cx.measureText(grapheme).width;
						const { x, row } = wrapper.box(width);
						rows[row] ??= graphemes.length;
						graphemes.push({ content: grapheme, stringIndex, row, x, width });
						stringIndex += grapheme.length;
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
					}
				}

				const row = wrapper.row;

				for (const grapheme of graphemeSplit(content.slice(box.length))) {
					if (grapheme === "\n") {
						graphemes.push({ stringIndex, row, x: wrapper.x, width: selectedNewlineWidth });
						wrapper.glue(Infinity);
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

			const height = padding_ + ascent + lineHeight * wrapper.row + descent + padding_;
			canvas.style.minHeight = `${height / devicePixelRatio()}px`;
			canvas.style.minWidth = `${wrapper.minWidth / devicePixelRatio()}px`;

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
			const { fontSize, lineHeight, ascent, descent } = baseMetrics();
			const selected_ = selected();
			const padding_ = padding();
			const graphemes = layout().graphemes;

			cx.clearRect(0, 0, deviceWidth(), deviceHeight());

			for (const [i, grapheme] of graphemes.entries()) {
				const x = padding_ + grapheme.x;
				const y = padding_ + ascent + lineHeight * grapheme.row;

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
					cx.fillRect(x, y - ascent, grapheme.width + 1, lineHeight);
				} else {
					textColor = "black";
				}

				if (grapheme.content !== undefined) {
					cx.fillStyle = textColor;
					cx.font = `${fontSize}px monospace`;
					cx.fillText(grapheme.content, x, y);
				}
			}

			if (displayCursor()) {
				const grapheme = graphemes[selected_.start];
				cx.fillStyle = "black";
				cx.fillRect(
					Math.round(padding_ + grapheme.x) || 1,
					padding_ + lineHeight * grapheme.row,
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

		const controller: SyntheticTextDisplay = {
			backspace: () => {
				if (props.setContent === undefined) {
					return;
				}
				const { start, end } = selected();
				if (start !== end) {
					deleteSelected();
				} else if (start !== 0) {
					batch(() => {
						props.setContent!(sliceContent(0, start - 1) + sliceContent(start));
						setSelected({ start: start - 1, end: start - 1 });
					});
				}
			},
			delete: () => {
				if (props.setContent === undefined) {
					return;
				}
				const { start, end } = normalizeSelection(selected());
				if (start !== end) {
					deleteSelected();
				} else if (start + 1 < layout().graphemes.length) {
					props.setContent(sliceContent(0, start) + sliceContent(start + 1));
				}
			},
			clear: () => {
				if (props.setContent === undefined) {
					return;
				}
				batch(() => {
					props.setContent!("");
					controller.home();
				});
			},
			insert: text => batch(() => {
				if (props.setContent === undefined) {
					return;
				}
				const { start, end } = normalizeSelection(selected());
				props.setContent(sliceContent(0, start) + text + sliceContent(end));
				const cursor = start + graphemeSplit(text).length;
				setSelected({ start: cursor, end: cursor });
			}),
			left: () => {
				const { start, end } = normalizeSelection(selected());
				if (start !== end) {
					setSelected({ start, end: start });
				} else if (start !== 0) {
					setSelected({ start: start - 1, end: start - 1 });
				}
			},
			right: () => {
				const { start, end } = normalizeSelection(selected());
				if (start !== end) {
					setSelected({ start: end, end });
				} else if (end + 1 < layout().graphemes.length) {
					setSelected({ start: end + 1, end: end + 1 });
				}
			},
			up: () => {
				const { start } = normalizeSelection(selected());
				const layout_ = layout();
				const { row, x } = layout_.graphemes[start];
				if (row === 0) {
					controller.home();
				} else {
					const { index } = graphemeInRow(layout_, row - 1, x);
					setSelected({ start: index, end: index });
				}
			},
			down: () => {
				const { end } = normalizeSelection(selected());
				const layout_ = layout();
				const { row, x } = layout_.graphemes[end];
				if (row + 1 >= layout_.rows.length) {
					controller.end();
				} else {
					const { index } = graphemeInRow(layout_, row + 1, x);
					setSelected({ start: index, end: index });
				}
			},
			home: () => {
				setSelected({ start: 0, end: 0 });
			},
			end: () => {
				const cursor = layout().graphemes.length - 1;
				setSelected({ start: cursor, end: cursor });
			},
		};

		if (props.ref instanceof Function) {
			props.ref(controller);
		}

		const graphemeAt = (x: number, y: number): { i: number, strict: boolean } => {
			const { lineHeight } = baseMetrics();
			const layout_ = layout();
			const padding_ = padding();

			x *= devicePixelRatio();
			y *= devicePixelRatio();

			x -= padding_;
			y -= padding_;

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
			props.onFocus?.call(undefined);
		});
		canvas.addEventListener("pointermove", e => {
			const grapheme = graphemeAt(e.offsetX, e.offsetY);

			if (grapheme.strict) {
				canvas.style.cursor = "text";
			} else {
				canvas.style.cursor = "";
			}

			if (canvas.hasPointerCapture(e.pointerId)) {
				setSelected(old => ({ start: old.start, end: grapheme.i }));
			}
		});
		canvas.addEventListener("focus", () => {
			setFocused(true);
			props.onFocus?.call(undefined);
		});
		canvas.addEventListener("blur", () => {
			if (document.activeElement === canvas) {
				return;
			}
			setFocused(false);
			props.onBlur?.call(undefined);
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
			if (focused() && start !== end && props.setContent !== undefined) {
				e.clipboardData?.setData("text/plain", sliceContent(start, end));
				props.setContent(sliceContent(0, start) + sliceContent(end));
				setSelected({ start, end: start });
				e.preventDefault();
			}
		};
		const onCopy = (e: ClipboardEvent): void => {
			const { start, end } = normalizeSelection(selected());
			if (focused() && start !== end) {
				e.clipboardData?.setData("text/plain", sliceContent(start, end));
				e.preventDefault();
			}
		};
		const onPaste = (e: ClipboardEvent): void => {
			if (focused() && e.clipboardData !== null) {
				controller.insert(e.clipboardData.getData("text/plain"));
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
	minWidth: number;

	constructor(public width: number) {
		this.x = 0;
		this.row = 0;
		this.minWidth = 0;
	}

	box(width: number): { x: number, row: number } {
		if (this.x !== 0 && this.x + width > this.width) {
			this.x = 0;
			this.row += 1;
		}
		const coord = { x: this.x, row: this.row };
		this.x += width;
		this.minWidth = Math.max(this.minWidth, width);
		return coord;
	}

	glue(width: number): void {
		this.x += width;
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
