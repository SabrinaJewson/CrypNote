import { batch, createEffect, createMemo, createSignal } from "solid-js";
import { For } from "solid-js";
import { JSX } from "solid-js";

export default function<T>(props: {
	list: T[],
	setList: (f: (old: T[]) => T[]) => void,
	fallback?: JSX.Element,
	children: (
		item: T,
		i: () => number,
		preDrag: () => boolean,
		isDragged: () => boolean,
		handle: (props: { children?: JSX.Element }) => JSX.Element,
		hovered: () => boolean,
	) => HTMLElement,
}): JSX.Element {
	const [dragging, setDragging] = createSignal<null | number>(null);

	return <For each={props.list} fallback={props.fallback}>{(item, i) => {
		return createMemo(() => {
			const handle = (props: { children?: JSX.Element }): JSX.Element => {
				return <div
					class="handle"
					draggable={true}
					onDragStart={e => {
						e.dataTransfer!.dropEffect = "move";
						e.dataTransfer!.effectAllowed = "move";
						const elRect = el.getBoundingClientRect();
						e.dataTransfer!.setDragImage(el, e.x - elRect.x, e.y - elRect.y);
						setDragging(i());
					}}
				>{props.children}</div>;
			};

			const [preDrag, setPreDrag] = createSignal(false);
			const [isDragged, setIsDragged] = createSignal(false);
			let frame: number | undefined;
			createEffect(() => {
				if (i() === dragging()) {
					setPreDrag(true);
					frame = requestAnimationFrame(() => {
						setPreDrag(false);
						setIsDragged(true);
					});
				} else {
					setIsDragged(false);
					if (frame !== undefined) {
						cancelAnimationFrame(frame);
						frame = undefined;
						setPreDrag(false);
					}
				}
			});

			// Browsers treat the cursor as being in the same place during and after a drag
			// operation, so we work around that by handling hovering manually, and disabling it
			// during and after drags.
			const [hovered, setHovered] = createSignal(false);
			createEffect(() => {
				if (dragging() === null) {
					setHovered(false);
				}
			});

			const actuallyHovered = createMemo(() => dragging() === null && hovered());

			const el = props.children(item, i, preDrag, isDragged, handle, actuallyHovered);
			el.onmouseenter = () => setHovered(true);
			el.onmouseleave = () => setHovered(false);
			el.ondragenter = e => {
				const oldDragging = dragging();
				if (oldDragging === null) {
					return;
				}
				const oldI = i();
				if (oldI !== oldDragging) {
					batch(() => {
						setDragging(oldI);
						props.setList(oldList => {
							const list = [...oldList];
							const dragged = list[oldDragging];
							if (oldDragging < oldI) {
								// Dragging down
								list.copyWithin(oldDragging, oldDragging + 1, oldI + 1);
							} else {
								// Dragging up
								list.copyWithin(oldI + 1, oldI, oldDragging);
							}
							list[oldI] = dragged;
							return list;
						});
					});
				}
				e.preventDefault();
				e.dataTransfer!.dropEffect = "move";
			};
			el.ondragover = e => {
				if (dragging() !== null) {
					e.preventDefault();
				}
			};
			el.ondrop = e => {
				if (dragging() !== null) {
					e.preventDefault();
				}
			};
			el.ondragend = () => setDragging(null);
			return el;
		});
	}}</For>;
}
