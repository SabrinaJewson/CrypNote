import { For, Show } from "solid-js";
import { SetStoreFunction, Store, createStore } from "solid-js/store";
import { createEffect, createMemo, createResource, createSignal, onMount } from "solid-js";
import { Dynamic } from "solid-js/web";
import { JSX } from "solid-js";
import graphemeSplit from "graphemesplit";
import { LineBreaker as lineBreaker } from "css-line-break";

import { DecodedKind, Message, MessageKind, NotForYouError, contactCard, decode, encryptMessage, signMessage } from "../lib/encoded";
import { Exportable, Importable } from "./exportable";
import { Fading, FadingState } from "./fading";
import { InvalidFormatError, OutdatedError } from "../serde";
import { Keyboard, KeyboardHandler } from ".";
import { SharedContact, UnlockedAccount, UnlockedPassword } from "../lib";
import { Bytes } from "../bytes";
import OrderableList from "./orderableList";
import { assertEq } from "../test";
import { eq } from "../eq";
import { exhausted } from "../index";

import "./dashboard.scss";

export default function(props: {
	account: Store<UnlockedAccount>,
	setAccount: SetStoreFunction<UnlockedAccount>,
	keylogged: boolean,
	scraped: boolean,
	logOut: () => void,
	keyboard: Keyboard,
}): JSX.Element {
	enum Screen { Decode, Encrypt, Sign, Contacts, UserProfile }

	const [screen, setScreen] = createSignal(Screen.Decode);
	// TODO: remove
	setScreen(Screen.Decode);

	const outerProps = props;

	const ScreenButton = (props: {
		variant: Screen,
		children: JSX.Element[] | JSX.Element,
	}): JSX.Element => {
		return <div
			classList={{ active: screen() === props.variant }}
			onClick={() => setScreen(props.variant)}
		>
			{props.children}
		</div>;
	};

	const ScreenPanel = (props: { variant: Screen, inner: (props: ScreenProps) => JSX.Element }): JSX.Element => {
		return <div class="rightPanel" classList={{ shown: screen() === props.variant}}>
			<Dynamic
				component={props.inner}
				account={outerProps.account}
				setAccount={outerProps.setAccount}
				keylogged={outerProps.keylogged}
				scraped={outerProps.scraped}
				keyboard={outerProps.keyboard}
			/>
		</div>;
	};

	return <div class="dashboard">
		<div class="leftPanel">
			<ScreenButton variant={Screen.Decode}>Decode</ScreenButton>
			<ScreenButton variant={Screen.Encrypt}>Encrypt</ScreenButton>
			<ScreenButton variant={Screen.Sign}>Sign</ScreenButton>
			<ScreenButton variant={Screen.Contacts}>Contacts</ScreenButton>
			<ScreenButton variant={Screen.UserProfile}>User Profile</ScreenButton>
			<div onClick={props.logOut}>Log Out</div>
		</div>
		<ScreenPanel variant={Screen.Decode} inner={Decode} />
		<ScreenPanel variant={Screen.Encrypt} inner={Encrypt} />
		<ScreenPanel variant={Screen.Sign} inner={Sign} />
		<ScreenPanel variant={Screen.Contacts} inner={Contacts} />
		<ScreenPanel variant={Screen.UserProfile} inner={UserProfile} />
	</div>;
}

interface ScreenProps {
	keylogged: boolean,
	scraped: boolean,
	account: Store<UnlockedAccount>,
	setAccount: SetStoreFunction<UnlockedAccount>,
	keyboard: Keyboard,
}

function Decode(props: ScreenProps): JSX.Element {
	const [encoded, setEncoded] = createSignal(Bytes.new());

	const [decoded] = createResource(encoded, async encoded => {
		if (encoded.isEmpty()) {
			return null;
		}
		try {
			return await decode(props.account, encoded);
		} catch (e) {
			if (e instanceof InvalidFormatError || e instanceof OutdatedError || e instanceof NotForYouError) {
				return e;
			} else {
				throw e;
			}
		}
	});

	return <>
		<h1>Decode</h1>
		<p>
			You can input any encrypted message, signed message or contact card in the box below,
			and CrypNote will decode it for you.
		</p>
		<Importable rows={6} setData={setEncoded} />
		{() => {
			const decoded_ = decoded();
			if (decoded_ === null) {
				return <></>;
			}
			if (decoded_ === undefined) {
				return <p>Loading...</p>;
			}
			if (decoded_ instanceof InvalidFormatError) {
				return <p>This message's format is invalid.</p>;
			}
			if (decoded_ instanceof OutdatedError) {
				return <p>Your client is outdated; please upgrade.</p>;
			}
			if (decoded_ instanceof NotForYouError) {
				return <p>You are not the intended recipient of this message.</p>;
			}
			if (decoded_.kind === DecodedKind.Message) {
				return <>
					<DisplaySharedContact
						contact={decoded_.sender}
						you={"Sent by you."}
						other={name => `Sender: ${name}`}
						unknown={"Sent by an unknown contact."}
						{...props}
					/>
					{decoded_.message === null
						? <p>
							You cannot read this message because you are not its intended recipient,
							or the message was modified in transit.
						</p>
						: <DisplayMessage message={decoded_.message} scraped={props.scraped} />
					}
				</>;
			}
			if (decoded_.kind === DecodedKind.Signed) {
				const ok = (name: string): JSX.Element => <span class="verified">
					✓ This message is verified to have been written by {name}.
				</span>;
				const error = (name: string): JSX.Element => (<>
					⚠ This message claims to have been written by {name}, but the signature does not
					match. It was likely forged.
				</>);

				return <>
					<Show when={decoded_.verified}>
						<DisplaySharedContact
							contact={decoded_.sender}
							you={ok("you")}
							other={ok}
							unknown={ok("an unknown contact")}
							{...props}
						/>
					</Show>
					<Show when={!decoded_.verified}>
						<div class="verifyError">
							<DisplaySharedContact
								contact={decoded_.sender}
								you={error("you")}
								other={error}
								unknown={error("an unknown contact")}
								{...props}
							/>
						</div>
					</Show>
					<DisplayMessage message={decoded_.message} scraped={false} />
				</>;
			}
			if (decoded_.kind === DecodedKind.SharedContact) {
				return <DisplaySharedContact
					contact={decoded_.contact}
					you={"This is your contact card."}
					other={name => `The contact card of ${name}.`}
					unknown={"The contact card of an unknown contact."}
					{...props}
				/>;
			}
			exhausted(decoded_);
		}}
	</>;
}

function DisplaySharedContact(props: ScreenProps & {
	you: JSX.Element,
	other: (name: string) => JSX.Element,
	unknown: JSX.Element,
	contact: SharedContact,
}): JSX.Element {
	return createMemo(() => {
		if (props.contact.isAccount(props.account)) {
			return <p>{props.you}</p>;
		}
		const known = props.account.contacts.find(contact => eq(contact.shared, props.contact));
		if (known !== undefined) {
			return <p>{props.other(known.nickname)}</p>;
		}
		return <>
			<p>{props.unknown}</p>
			<p>Public key: <code>{props.contact.dsaPublicKey.toString()}</code></p>
			<form action="javascript:void(0)" onSubmit={e => {
				const elements = (e.target as HTMLFormElement).elements;
				const nickname = (elements.namedItem("nickname") as HTMLInputElement).value;
				const contact = {
					shared: props.contact,
					nickname,
					note: "",
				};
				props.setAccount("contacts", c => [...c, contact]);
			}}>
				<label>Give them a nickname: <input type="text" name="nickname" required /></label>
				<button>Add to Contacts</button>
			</form>
		</>;
	});
}

function Encrypt(props: ScreenProps): JSX.Element {
	const [recipient, setRecipient] = createSignal("");

	const [message, setMessage] = createStore({ kind: MessageKind.Text, content: "" });

	const [encrypted, { refetch: regenerate }] = createResource(() => {
		if (recipient() === "you") {
			return encryptMessage(props.account, null, message);
		} else if (parseInt(recipient()) < props.account.contacts.length) {
			return encryptMessage(
				props.account,
				props.account.contacts[recipient() as unknown as number].shared,
				message,
			);
		} else {
			return Promise.resolve(undefined);
		}
	}, promise => promise);

	return <>
		<h1>Encrypt</h1>
		<p>
			An encrypted message will be only readable by one other person in the world - and the
			NSA, of course. Anyone can tell who sent an encrypted message, but they can't see who is
			going to receive it.
		</p>
		<p>
			<strong>Confidentiality</strong> is guaranteed: this means the contents of the messages
			cannot be read by anyone other than the dedicated recipient. However, if
			the recipient were to have their secrets leaked, this message would be revealed also.
		</p>
		<p>
			Encrypted messages also guarantee <strong>integrity</strong> and 
			<strong>authenticity</strong>. This means that if you receive an encrypted message, you
			know for certain that it has not been tampered with since it was encrypted, and neither
			has the sender of the message (a non-encrypted, public attribute of the message) been
			changed.
		</p>
		<p>
			However, encrypted messages <strong>do not</strong> guarantee 
			<strong>non-repudiability</strong>. This means that it is possible for any party on
			either side of the transfer to write a message that looks like it was written by the
			other. But as a consequence, if the secrets of the person you are talking to were leaked
			and all your messages to them were revealed, it would not be possible for anyone to
			prove that you did or did not send a given message. If you want non-repudiability, sign
			your message instead.
		</p>
		<p>
			You also have the ability to send a message to yourself. In this case, the message will
			only be readable by you.
		</p>
		<p><label>Recipient: <select onInput={e => setRecipient((e.target as HTMLSelectElement).value)}>
			<option value="">Select a contact</option>
			<option value="you">Yourself</option>
			<For each={props.account.contacts}>{(contact, i) => {
				return <option value={i().toString()}>{contact.nickname}</option>;
			}}</For>
		</select></label></p>
		<MessageInput
			keylogged={props.keylogged}
			scraped={props.scraped}
			message={message}
			setMessage={setMessage}
			keyboard={props.keyboard}
		/>
		<Show when={encrypted() !== undefined} fallback={<p>Select an account to receive the message.</p>}>
			<button type="button" onClick={regenerate}>Regenerate</button>
			<Exportable data={encrypted()!} />
		</Show>
	</>;
}

function Sign(props: ScreenProps): JSX.Element {
	const [message, setMessage] = createStore({ kind: MessageKind.Text, content: "" });

	const [signed] = createResource(() => signMessage(props.account, message), promise => promise);

	return <>
		<h1>Sign</h1>
		<p>A signed message will be readable by anyone, and verifiable that it came from you.</p>
		<p>
			Specifically, signed messages provide <strong>integrity</strong>, 
			<strong>authenticity</strong> and <strong>non-repudiability</strong>, but <strong>not 
			confidentiality</strong>. It is not possible for anyone to forge a message that looks
			like it was signed by you, or to modify an existing message signed by you. If you have
			created a signed message, it is possible for anyone to read the message and prove to
			both themselves and anyone else that it was you who wrote it.
		</p>
		<MessageInput
			keylogged={false}
			scraped={false}
			message={message}
			setMessage={setMessage}
			keyboard={props.keyboard}
		/>
		<Show when={signed() !== undefined} fallback={<p>Loading...</p>}>
			<Exportable data={signed()!} />
		</Show>
	</>;
}

function Contacts(props: ScreenProps): JSX.Element {
	return <>
		<h1>Contacts</h1>
		<OrderableList
			list={props.account.contacts}
			setList={f => props.setAccount("contacts", f) }
			fallback={<p>You have no contacts.</p>}
		>{(contact, i, _preDrag, isDragged, Handle) => {
			return <div class="contact" classList={{ dragged: isDragged() }}>
				<Handle />
				<input type="text" value={contact.nickname} onInput={e => {
					const updated = (e.target as HTMLInputElement).value;
					props.setAccount("contacts", i(), "nickname", updated);
				}} />
				<p>Public key: <code>{contact.shared.dsaPublicKey.toString()}</code></p>
				<p>Contact card:</p>
				<Exportable data={contactCard(contact.shared)} />
				<p><label>Note <textarea value={contact.note} onInput={e => {
					const updated = (e.target as HTMLTextAreaElement).value;
					props.setAccount("contacts", i(), "note", updated);
				}} /></label></p>

				<button type="button" class="warn" onClick={() => {
					props.setAccount("contacts", contacts => {
						return [...contacts.slice(0, i()), ...contacts.slice(i() + 1)];
					});
				}}>Delete contact</button>
			</div> as HTMLElement;
		}}</OrderableList>
		<p>
			You can add new contacts by entering encrypted messages, signed messages or contact
			cards into the decoding box.
		</p>
	</>;
}

function UserProfile(props: ScreenProps): JSX.Element {
	const [sharedContact] = createResource(async () => {
		return contactCard(await SharedContact.ofAccount(props.account));
	});

	const check = (e: InputEvent): void => {
		const form = (e.target as HTMLInputElement).form!;
		const newPassword = form.elements.namedItem("new") as HTMLInputElement;
		const confirmPassword = form.elements.namedItem("confirm") as HTMLInputElement;
		confirmPassword.setCustomValidity(newPassword.value === confirmPassword.value ? "" : "Passwords do not match");
	};

	const changedPassword = new FadingState();

	return <>
		<h1>User Profile</h1>
		<label>Name: <input
			value={props.account.publicData.name}
			onInput={e => props.setAccount("publicData", "name", (e.target as HTMLInputElement).value)}
		/></label>
		<p>Public key: <code>{props.account.publicData.dsaPublicKey.toString()}</code></p>
		<Show when={sharedContact() !== undefined}>
			<p>Contact card:</p>
			<Exportable data={sharedContact()!} />
			<p>
				You may freely share this with other people to allow them to contact you. It will
				also be attached to every message you encrypt or sign.
			</p>
		</Show>
		<form action="javascript:void(0)" onSubmit={e => {
			const elements = (e.target as HTMLFormElement).elements;
			const newPassword = elements.namedItem("new") as HTMLInputElement;
			void (async () => {
				props.setAccount("password", await UnlockedPassword.new(newPassword.value));
				changedPassword.show();
			})();
		}}>
			<h2>Change password</h2>
			<p><label>New password: <input type="password" name="new" required onInput={check} /></label></p>
			<p><label>Confirm new password: <input type="password" name="confirm" required onInput={check} /></label></p>
			<button>Change password</button>
			<Fading state={changedPassword}>{<p>Changed password!</p> as HTMLElement}</Fading>
		</form>
	</>;
}

function MessageInput(props: {
	keylogged: boolean,
	scraped: boolean,
	message: Message,
	setMessage: SetStoreFunction<Message>,
	keyboard: Keyboard,
}): JSX.Element {
	return createMemo(() => {
		if (!props.keylogged) {
			return <textarea
				rows="12"
				value={props.message.content}
				onInput={e => props.setMessage("content", (e.target as HTMLTextAreaElement).value)}
			/>;
		}

		let area!: HTMLTextAreaElement;

		const handler: KeyboardHandler = {
			onInput: input => {
				const selectionStart = area.selectionStart;
				const selectionEnd = area.selectionEnd;
				if (input === "\b") {
					if (selectionStart === selectionEnd) {
						if (selectionStart !== 0) {
							props.setMessage("content", content => {
								return content.slice(0, selectionStart - 1) + content.slice(selectionStart);
							});
							area.selectionStart = selectionStart - 1;
							area.selectionEnd = selectionEnd - 1;
						}
					} else {
						props.setMessage("content", content => {
							return content.slice(0, selectionStart) + content.slice(selectionEnd);
						});
						area.selectionEnd = selectionStart;
					}
				} else {
					props.setMessage("content", content => {
						return content.slice(0, selectionStart) + input + content.slice(selectionEnd);
					});
					area.selectionStart = selectionStart + input.length;
					area.selectionEnd = selectionStart + input.length;
				}
			},
		};

		return <textarea
			ref={area}
			rows="12"
			value={props.message.content}
			on:beforeinput={e => {
				// Prevent undo and redo because it doesn't work with the custom keyboard.
				if (e.inputType === "insertText" || e.inputType === "historyUndo" || e.inputType === "historyRedo") {
					e.preventDefault();
				}
			}}
			onInput={() => props.setMessage("content", area.value)}
			onFocus={() => props.keyboard.show(handler)}
			onClick={() => props.keyboard.show(handler)}
			onBlur={() => {
				if (area !== document.activeElement) {
					props.keyboard.hide();
				}
			}}
		/>;
	});
}

function DisplayMessage(props: { scraped: boolean, message: Message }): JSX.Element {
	return createMemo(() => {
		if (!props.scraped) {
			return <pre class="messageDisplay">{props.message.content}</pre>;
		}

		const [width, setWidth] = createSignal(0);

		const canvas = <canvas width={width()} /> as HTMLCanvasElement;
		const container = <div class="messageDisplay">{canvas}</div> as HTMLDivElement;

		const observer = new ResizeObserver(([entry]) => {
			setWidth(entry.contentBoxSize[0].inlineSize);
		});
		observer.observe(container);

		const cx = canvas.getContext("2d", { alpha: false });
		if (cx === null) {
			return <p>Failed to set up renderer.</p>;
		}

		onMount(() => {
			const fontSize = 13;
			const lineHeight = Math.floor(1.2 * fontSize);
			cx.font = `${fontSize}px monospace`;

			const spaceMetrics = cx.measureText(" ");
			const tabWidth = spaceMetrics.width * 8;

			// If `fontBoudingBox{Ascent, Descent}` is not supported, we fall back to measuring the
			// actual bounding box of characters that (on my font) have a bounding box very close to
			// that of the font's.
			const ascent = spaceMetrics.fontBoundingBoxAscent
				?? cx.measureText("Ã").actualBoundingBoxAscent;
			const descent = spaceMetrics.fontBoundingBoxDescent
				?? Math.round(cx.measureText("ଡ଼").actualBoundingBoxDescent);

			interface Grapheme {
				content: string,
				index: number,
				x: number,
				width: number,
			}
			const graphemes = createMemo(() => {
				const graphemes: Grapheme[][] = [];

				const wrapper = new WordWrapper(width());
				let index = 0;
				const lines = { [Symbol.iterator]: () => lineBreaker(props.message.content) };
				for (const line of lines) {
					const content = line.slice();

					const box = content.trimEnd();
					const { x: startX, y } = wrapper.box(cx.measureText(box).width);

					if (graphemes[y] === undefined) {
						graphemes.push([]);
						assertEq(graphemes.length, y + 1);
					}

					let x = startX;

					for (const grapheme of graphemeSplit(box)) {
						const width = cx.measureText(grapheme).width;
						graphemes[y].push({ content: grapheme, index, x, width });
						x += width;
						index += grapheme.length;
					}

					for (const grapheme of graphemeSplit(content.slice(box.length))) {
						let width: number;
						if (grapheme === "\n") {
							width = 1;
							wrapper.glue(Infinity);
						} else if (grapheme === "\t") {
							width = Math.floor(x / tabWidth) * tabWidth + tabWidth - x;
							wrapper.glue(width);
						} else {
							width = cx.measureText(grapheme).width;
							wrapper.glue(width);
						}
						graphemes[y].push({ content: grapheme, index, x, width });
						x += width;
						index += grapheme.length;
					}
				}

				if (wrapper.extendedWidth > wrapper.width) {
					setWidth(wrapper.extendedWidth);
				} else {
					canvas.height = ascent + lineHeight * wrapper.y + descent;
				}

				return graphemes;
			});

			const [selected, setSelected] = createSignal({ start: 0, end: 0 });

			createEffect(() => {
				cx.fillStyle = "white";
				cx.fillRect(0, 0, canvas.width, canvas.height);

				const selected_ = selected();

				for (const [yIndex, row] of graphemes().entries()) {
					const y = ascent + lineHeight * yIndex;

					for (const { content, index, x, width } of row) {
						if (
							index >= selected_.start && index < selected_.end
							|| index >= selected_.end && index < selected_.start
						) {
							cx.fillStyle = "#3297FD";
							cx.fillRect(x, y - ascent, width + 1, lineHeight);
							cx.fillStyle = "white";
						} else {
							cx.fillStyle = "black";
						}
						cx.font = `${fontSize}px monospace`;
						cx.fillText(content, x, y);
					}
				}
			});

			const graphemeAt = (x: number, y: number): number | null => {
				const graphemes_ = graphemes();
				if (graphemes_.length === 0) {
					return null;
				}
				if (y < 0) {
					return graphemes_[0][0].index;
				}
				const yIndex = Math.floor(y / lineHeight);
				if (yIndex >= graphemes_.length) {
					const row = graphemes_[graphemes_.length - 1];
					return row[row.length - 1].index + 1;
				}
				const row = graphemes_[yIndex];
				return row.find(grapheme => x < grapheme.x + grapheme.width)?.index ?? row[row.length - 1].index + 1;
			};

			canvas.addEventListener("pointerdown", e => {
				canvas.setPointerCapture(e.pointerId);
				const i = graphemeAt(e.offsetX, e.offsetY);
				if (i !== null) {
					setSelected({ start: i, end: i });
				}
			});
			canvas.addEventListener("pointermove", e => {
				if (!canvas.hasPointerCapture(e.pointerId)) {
					return;
				}
				const i = graphemeAt(e.offsetX, e.offsetY);
				if (i !== null) {
					setSelected(old => ({ start: old.start, end: i }));
				}
			});
		});

		return container;
	});
}

class WordWrapper {
	x: number;
	y: number;
	extendedWidth: number;

	constructor(public width: number) {
		this.x = 0;
		this.y = 0;
		this.extendedWidth = width;
	}

	box(width: number): { x: number, y: number } {
		if (this.x !== 0 && this.x + width > this.width) {
			this.x = 0;
			this.y += 1;
		}
		const coord = { x: this.x, y: this.y };
		this.x += width;
		this.extendedWidth = Math.max(this.extendedWidth, this.x);
		return coord;
	}

	glue(width: number): void {
		this.x += width;
	}
}

declare module "solid-js" {
	namespace JSX {
		interface CustomEvents {
			beforeinput: InputEvent,
		}
	}
}
