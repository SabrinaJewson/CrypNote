import { Match, Show, Switch } from "solid-js";
import { createEffect, createMemo, createResource, createSignal, on } from "solid-js";
import { JSX } from "solid-js";

import { Bytes, BytesReader } from "../bytes";
import { Exportable, Importable } from "./exportable";
import { IncorrectPassword, LockedAccount, TamperedError, UnlockedAccount, createAccount } from "../lib";
import { InvalidFormatError, OutdatedError } from "../serde";
import OrderableList from "./orderableList";
import { ReactiveAccount } from ".";
import { eq } from "../eq";
import { exhausted } from "../index";

import "./accounts.scss";

export default function(props: {
	accounts: ReactiveAccount[],
	setAccounts: (updater: (old: ReactiveAccount[]) => ReactiveAccount[]) => void,
	onLogin: (i: number, unlocked: UnlockedAccount) => void,
}): JSX.Element {
	const creating: unique symbol = Symbol();
	const importing: unique symbol = Symbol();
	const [selected, setSelected] = createSignal<number | null | typeof creating | typeof importing>(null);
	//setSelected(0); // TODO: remove

	return <div class="accounts">
		<div class="left">
			<div class="options">
				<OrderableList
					list={props.accounts}
					setList={props.setAccounts}
					fallback={<p>No accounts</p>}
				>{(account, i, preDrag, isDragged, Handle, hovered) => {
					createEffect(on([selected, i], ([selected, i], old) => {
						if (old === undefined) {
							return;
						}
						const [oldSelected, oldI] = old;
						// If our index was changed and we were selected, update the selected index
						// too.
						if (oldI !== i && oldSelected === selected && oldSelected === oldI) {
							setSelected(i);
						}
					}));

					return <div
						class="account"
						classList={{
							active: selected() === i(),
							preDrag: preDrag(),
							dragged: isDragged(),
							hovered: hovered(),
						}}
						onClick={() => setSelected(selected => i() === selected ? null : i())}
					>
						<Handle />
						<span>{account.locked().publicData.name}</span>
					</div> as HTMLElement;
				}}</OrderableList>
			</div>
			<button type="button" onClick={() => setSelected(creating)}>Create account</button>
			<button type="button" onClick={() => setSelected(importing)}>Import account</button>
		</div>
		<div class="content">
			<Switch>
				<Match when={typeof selected() === "number"}>
					<Account
						account={props.accounts[selected() as number].locked()}
						onLogin={unlocked => props.onLogin(selected() as number, unlocked)}
						onDelete={() => {
							const i = selected() as number;
							setSelected(null);
							props.setAccounts(accounts => [...accounts.slice(0, i), ...accounts.slice(i + 1)]);
						}}
					/>
				</Match>
				<Match when={selected() === creating}>
					<CreateAccount onCreated={async inputs => {
						const account = ReactiveAccount.new(await LockedAccount.lock(
							await createAccount(inputs.name, inputs.password)
						));
						props.setAccounts(accounts => [...accounts, account]);
						setSelected(props.accounts.length - 1);
					}} />
				</Match>
				<Match when={selected() === importing}>
					<ImportAccount accounts={props.accounts} onImported={(imported, i) => {
						const account = ReactiveAccount.new(imported);
						props.setAccounts(accounts => {
							const newAccounts = [...accounts];
							newAccounts[i] = account;
							return newAccounts;
						});
						setSelected(i);
					}} />
				</Match>
				<Match when={true}>
				</Match>
			</Switch>
		</div>
		{/*
		<Switch>
			<Match when={creatingAccount()}>
				<a onClick={() => setCreatingAccount(false)}>Back</a>
				<CreateAccount onCreated={async inputs => {
					const account = ReactiveAccount.new(await LockedAccount.lock(
						await createAccount(inputs.name, inputs.password)
					));
					props.setAccounts(accounts => [...accounts, account]);
					setCreatingAccount(false);
				}} />
			</Match>
			<Match when={loggingIn() !== null}>
				<a onClick={() => setLoggingIn(null)}>Back</a>
				<Login
					account={props.accounts[loggingIn()!].locked()}
					onSuccess={unlocked => props.onLogin(loggingIn()!, unlocked)}
				/>
			</Match>
			<Match when={true}>
				<AccountSelection accounts={props.accounts} onSelected={i => setLoggingIn(i)} />
				<button type="button" onClick={() => setCreatingAccount(true)}>Create account</button>
			</Match>
		</Switch>
		  */}
	</div>;
}

function Account(props: {
	account: LockedAccount,
	onLogin: (unlocked: UnlockedAccount) => void,
	onDelete: () => void,
}): JSX.Element {
	const [loggingIn, setLoggingIn] = createSignal(false);
	const [error, setError] = createSignal("");

	let previousTimeout: null | number = null;
	createEffect(() => {
		if (previousTimeout !== null) {
			clearTimeout(previousTimeout);
		}
		if (error() !== "") {
			previousTimeout = window.setTimeout(
				() => {
					previousTimeout = null;
					setError("");
				},
				3000,
			);
		}
	});

	// TODO: remove
	// void (async () => {
	// 	props.onLogin(await props.account.unlock("a"));
	// })();

	return <>
		<form action="javascript:void(0)" onSubmit={e => {
			const elements = (e.target as HTMLFormElement).elements;
			const password = (elements.namedItem("password") as HTMLInputElement).value;

			void (async () => {
				try {
					props.onLogin(await props.account.unlock(password));
				} catch (e) {
					if (e instanceof IncorrectPassword) {
						setError("Incorrect password");
					} else if (e instanceof TamperedError) {
						setError("The locked account data appears to have been tampered with.");
					} else {
						setError("An unknown error occurred; this is a bug. Try again.");
						throw e;
					}
				} finally {
					setLoggingIn(false);
				}
			})();
			setLoggingIn(true);
		}}>
			<h1>Log in</h1>
			<p>Account name: {props.account.publicData.name}</p>
			<p>Public key: <code>{props.account.publicData.dsaPublicKey.toString()}</code></p>
			<p><label>Password: <input type="password" name="password" required /></label></p>
			<button disabled={loggingIn()}>Log in</button>
			<Show when={error() !== ""}><p class="error">{error()}</p></Show>
		</form>
		<p><button type="button" class="warn" onClick={props.onDelete}>Delete Account</button></p>
		<p>Exported data:</p>
		<Exportable data={Bytes.buildWith(writer => props.account.writeTo(writer))} />
	</>;
}

function CreateAccount(props: { onCreated: (account: { name: string, password: string }) => void }): JSX.Element {
	return <form action="javascript:void(0)" onSubmit={e => {
		const elements = (e.target as HTMLFormElement).elements;
		props.onCreated({
			name: (elements.namedItem("name") as HTMLInputElement).value,
			password: (elements.namedItem("password") as HTMLInputElement).value,
		});
	}}>
		<h1>Create an account</h1>
		<p><label>Name: <input type="text" name="name" required maxlength="255" /></label></p>
		<p><label>Password: <input type="password" name="password" required /></label></p>
		<button>Create account</button>
	</form>;
}

function ImportAccount(props: {
	accounts: ReactiveAccount[],
	onImported: (account: LockedAccount, index: number) => void,
}): JSX.Element {
	const [data, setData] = createSignal(Bytes.new());
	const [account] = createResource(data, async data => {
		if (data.isEmpty()) {
			return;
		}
		try {
			const reader = new BytesReader(data);
			const account = await LockedAccount.readFrom(reader);
			if (!reader.bytes.isEmpty()) {
				throw new InvalidFormatError();
			}
			return account;
		} catch (e) {
			if (e instanceof InvalidFormatError || e instanceof OutdatedError) {
				return e;
			} else {
				throw e;
			}
		}
	});
	const accountIndex = createMemo(() => {
		const account_ = account();
		if (account_ instanceof LockedAccount) {
			const i = props.accounts.findIndex(a => eq(a.locked(), account_));
			if (i !== -1) {
				return i;
			}
		}
	});

	return <form action="javascript:void(0)" onSubmit={() => {
		const account_ = account();
		if (!(account_ instanceof LockedAccount)) {
			return;
		}
		props.onImported(account_, accountIndex() ?? props.accounts.length);
	}}>
		<h1>Import an account</h1>
		<p>Enter the exported account data below.</p>
		<Importable rows={25} setData={setData} />
		{() => {
			const account_ = account();

			if (account_ === undefined) {
				return;
			}

			if (account_ instanceof LockedAccount) {
				return <>
					<p>Account name: {account_.publicData.name}</p>
					<p>Public key: <code>{account_.publicData.dsaPublicKey.toString()}</code></p>
					<Switch>
						<Match when={props.accounts.some(a => eq(a.locked(), account_))}>
							<p>
								You already have this account imported. You may replace the stored
								one with this version.
							</p>
							<button>Replace existing account</button>
						</Match>
						<Match when={true}>
						<button>Import new account</button>
						</Match>
					</Switch>
				</>;
			}

			if (account_ instanceof InvalidFormatError) {
				return <p>Data is in an invalid format.</p>;
			}

			if (account_ instanceof OutdatedError) {
				return <p>Your client is oudated; please upgrade.</p>;
			}

			exhausted(account_);
		}}
	</form>;
}
