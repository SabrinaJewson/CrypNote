import { createEffect, createSignal } from "solid-js";
import { JSX } from "solid-js";
import { Show } from "solid-js";

enum FadingStage { Initial, Shown, Fading }
type FadingStateInner = never
	| { stage: FadingStage.Initial }
	| { stage: FadingStage.Shown, timer: number }
	| { stage: FadingStage.Fading };

const element: unique symbol = Symbol();
export class FadingState {
	private readonly inner: () => FadingStateInner;
	private readonly setInner: (updater: FadingStateInner | ((old: FadingStateInner) => FadingStateInner)) => void;

	constructor(readonly visibleFor: number = 300) {
		[this.inner, this.setInner] = createSignal({ stage: FadingStage.Initial });
	}
	show(): void {
		const timer = window.setTimeout(
			() => this.setInner({ stage: FadingStage.Fading }),
			this.visibleFor,
		);
		this.setInner(old => {
			if (old.stage === FadingStage.Shown) {
				window.clearTimeout(old.timer);
			}
			return { stage: FadingStage.Shown, timer };
		});
	}
	static [element](props: { state: FadingState, children: HTMLElement }): JSX.Element {
		return <Show when={props.state.inner().stage !== FadingStage.Initial}>
			{() => {
				const el = props.children;
				createEffect(() => {
					if (props.state.inner().stage === FadingStage.Fading) {
						el.classList.add("fade");
					} else {
						el.classList.remove("fade");
					}
				});
				el.ontransitionend = () => props.state.setInner({ stage: FadingStage.Initial });
				return el;
			}}
		</Show>;
	}
}

export function Fading(props: { state: FadingState, children: HTMLElement }): JSX.Element {
	return FadingState[element](props);
}
