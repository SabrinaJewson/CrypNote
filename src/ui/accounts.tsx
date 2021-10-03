import { Match, Show, Switch } from "solid-js";
import { createEffect, createMemo, createResource, createSignal } from "solid-js";
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
	accountBin: LockedAccount[],
	setAccountBin: (updater: (old: LockedAccount[]) => LockedAccount[]) => void,
	onLogin: (account: ReactiveAccount, unlocked: UnlockedAccount) => void,
}): JSX.Element {
	enum SelectedPage { Create, Import }
	const [selected, setSelected] = createSignal<null | SelectedPage | ReactiveAccount | LockedAccount>(null);

	const [binShown, showBin] = createSignal(false);

	return <div class="accounts">
		<div class="left">
			<Show when={!binShown()}>
				<div class="options">
					<OrderableList
						list={props.accounts}
						setList={props.setAccounts}
						fallback={<p>No accounts</p>}
					>{(account, _i, preDrag, isDragged, Handle, hovered) => {
						return <div
							class="account"
							classList={{
								active: selected() === account,
								preDrag: preDrag(),
								dragged: isDragged(),
								hovered: hovered(),
							}}
							onClick={() => setSelected(selected => selected === account ? null : account)}
						>
							<Handle />
							<span>{account.locked().publicData.name}</span>
						</div> as HTMLElement;
					}}</OrderableList>
				</div>
				<button type="button" onClick={() => setSelected(SelectedPage.Create)}>Create account</button>
				<button type="button" onClick={() => setSelected(SelectedPage.Import)}>Import account</button>
				<button type="button" onClick={() => showBin(true)}>Show account bin</button>
			</Show>
			<Show when={binShown()}>
				<div onClick={() => showBin(false)}>Back</div>
				<div class="options">
					<OrderableList
						list={props.accountBin}
						setList={props.setAccountBin}
						fallback={<p>Account bin is empty.</p>}
					>{(account, _i, preDrag, isDragged, Handle, hovered) => {
						return <div
							class="account"
							classList={{
								active: selected() === account,
								preDrag: preDrag(),
								dragged: isDragged(),
								hovered: hovered(),
							}}
							onClick={() => setSelected(selected => selected === account ? null : account)}
						>
							<Handle />
							<span>{account.publicData.name}</span>
						</div> as HTMLElement;
					}}</OrderableList>
				</div>
			</Show>
		</div>
		<div class="content">{() => {
			const selected_ = selected();

			if (selected_ instanceof ReactiveAccount) {
				return <Account
					account={selected_.locked()}
					onLogin={unlocked => props.onLogin(selected_, unlocked)}
					onDelete={() => {
						setSelected(null);
						props.setAccounts(accounts => arrayRemove(accounts, selected_));
						props.setAccountBin(bin => [...bin, selected_.locked()]);
					}}
				/>;
			}

			if (selected_ instanceof LockedAccount) {
				return <>
					<p>Account name: {selected_.publicData.name}</p>
					<p>Public key: <code>{selected_.publicData.dsaPublicKey.toString()}</code></p>
					<p><button type="button" onClick={() => {
						const account = ReactiveAccount.new(selected_);
						props.setAccounts(accounts => [...accounts, account]);
						props.setAccountBin(bin => arrayRemove(bin, selected_));
						setSelected(account);
						showBin(false);
					}}>Restore account</button></p>
					<p><button type="button" class="warn" onClick={() => {
						props.setAccountBin(bin => arrayRemove(bin, selected_));
						setSelected(null);
					}}>Permanently delete account</button></p>
					<p>Exported data:</p>
					<Exportable data={Bytes.buildWith(writer => selected_.writeTo(writer))} />
				</>;
			}

			if (selected_ === SelectedPage.Create) {
				return <CreateAccount onCreated={async inputs => {
					const account = ReactiveAccount.new(await LockedAccount.lock(
						await createAccount(inputs.name, inputs.password)
					));
					props.setAccounts(accounts => [...accounts, account]);
					setSelected(account);
				}} />
			}

			if (selected_ === SelectedPage.Import) {
				return <ImportAccount
					accounts={props.accounts}
					accountBin={props.accountBin}
					onImport={imported => {
						const account = ReactiveAccount.new(imported);
						props.setAccounts(accounts => [...accounts, account]);
						setSelected(account);
					}}
					onReplace={(imported, i) => {
						props.accounts[i].setLocked(imported);
						setSelected(props.accounts[i]);
					}}
					onRestore={(imported, i) => {
						props.setAccountBin(bin => [...bin.slice(0, i), ...bin.slice(i + 1)]);
						const account = ReactiveAccount.new(imported);
						props.setAccounts(accounts => [...accounts, account]);
						setSelected(account);
					}}
				/>;
			}

			if (selected_ === null) {
				return <></>;
			}

			exhausted(selected_);
		}}</div>
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
		<p>
			Exported account data is below. You can import this to any other CrypNote instance using
			the "Import account" button. You are strongly recommended to frequently back up the
			exported account data of any accounts you have to avoid the accidental clearance of
			browser cache causing you to lose access to your account.
		</p>
		<p>
			The below data is encrypted; although it contains all the secrets of your account, it
			can't be accessed without your password.
		</p>
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
	accountBin: LockedAccount[],
	onImport: (account: LockedAccount) => void,
	onReplace: (account: LockedAccount, index: number) => void,
	onRestore: (account: LockedAccount, index: number) => void,
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

	enum OperationKind { Import, Replace, Restore }

	const operation = createMemo(() => {
		const account_ = account();
		if (account_ instanceof LockedAccount) {
			const accountsIndex = props.accounts.findIndex(a => eq(a.locked(), account_));
			if (accountsIndex !== -1) {
				return {
					kind: OperationKind.Replace,
					run: () => props.onReplace(account_, accountsIndex),
				};
			}

			const binIndex = props.accountBin.findIndex(a => eq(a, account_));
			if (binIndex !== -1) {
				return {
					kind: OperationKind.Restore,
					run: () => props.onRestore(account_, binIndex),
				};
			}

			return { kind: OperationKind.Import, run: () => props.onImport(account_) };
		}
	});

	return <form action="javascript:void(0)" onSubmit={() => operation()?.run()}>
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
						<Match when={operation()?.kind === OperationKind.Import}>
							<button>Import new account</button>
						</Match>
						<Match when={operation()?.kind === OperationKind.Replace}>
							<p>
								You already have this account imported. You may replace the stored
								one with this version.
							</p>
							<button>Replace existing account</button>
						</Match>
						<Match when={operation()?.kind === OperationKind.Restore}>
							<p>
								You have this account in your account bin. You may restore the
								account and replace it with this version. Alternatively, if you
								enter your account bin you can restore it but not replace it.
							</p>
							<button>Restore and replace</button>
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

function arrayRemove<T>(array: readonly T[], remove: T): T[] {
	const updated: T[] = [];
	for (const item of array) {
		if (item !== remove) {
			updated.push(item);
		}
	}
	return updated;
}
