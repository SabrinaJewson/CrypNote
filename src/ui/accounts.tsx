import { createEffect, createResource, createSignal, on } from "solid-js";
import { JSX } from "solid-js";
import { Show } from "solid-js";

import { Bytes, BytesReader } from "../bytes";
import { Exportable, Importable } from "./exportable";
import { IncorrectPassword, LockedAccount, TamperedError, UnlockedAccount, createAccount } from "../lib";
import { InvalidFormatError, OutdatedError } from "../serde";
import Keyboard from "./keyboard";
import OrderableList from "./orderableList";
import PasswordInput from "./passwordInput";
import { ReactiveAccount } from ".";
import { exhausted } from "../index";
import { runTests } from "../test";

import "./accounts.scss";

export default function(props: {
	accounts: ReactiveAccount[],
	setAccounts: (updater: (old: ReactiveAccount[]) => ReactiveAccount[]) => void,
	accountBin: LockedAccount[],
	setAccountBin: (updater: (old: LockedAccount[]) => LockedAccount[]) => void,
	onLogin: (account: ReactiveAccount, unlocked: UnlockedAccount) => void,
	keylogged: boolean,
	scraped: boolean,
	setKeylogged: (v: boolean) => void,
	setScraped: (v: boolean) => void,
	keyboard: Keyboard,
}): JSX.Element {
	const enum SelectedPage { Create, Import, Settings }
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
				<button type="button" onClick={() => setSelected(SelectedPage.Settings)}>Settings</button>
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
					keylogged={props.keylogged}
					scraped={props.scraped}
					keyboard={props.keyboard}
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
				return <CreateAccount
					onCreated={async inputs => {
						const account = ReactiveAccount.new(await LockedAccount.lock(
							await createAccount(inputs.name, inputs.password)
						));
						props.setAccounts(accounts => [...accounts, account]);
						setSelected(account);
					}}
					keylogged={props.keylogged}
					scraped={props.scraped}
					keyboard={props.keyboard}
				/>
			}

			if (selected_ === SelectedPage.Import) {
				return <ImportAccount
					onImport={imported => {
						const account = ReactiveAccount.new(imported);
						props.setAccounts(accounts => [...accounts, account]);
						setSelected(account);
					}}
				/>;
			}

			if (selected_ === SelectedPage.Settings) {
				return <Settings
					keylogged={props.keylogged}
					scraped={props.scraped}
					setKeylogged={props.setKeylogged}
					setScraped={props.setScraped}
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
	keylogged: boolean,
	scraped: boolean,
	keyboard: Keyboard,
}): JSX.Element {
	const [loggingIn, setLoggingIn] = createSignal(false);
	const [error, setError] = createSignal("");
	const [password, setPassword] = createSignal("");
	createEffect(on(password, () => setError("")));

	let logInButton!: HTMLButtonElement;

	return <>
		<form action="javascript:void(0)" onSubmit={() => {
			if (password() === "") {
				setError("Enter a password");
				return;
			}

			void (async () => {
				try {
					props.onLogin(await props.account.unlock(password()));
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
			<p><PasswordInput
				label="Password: "
				value={password()}
				setValue={setPassword}
				keylogged={props.keylogged}
				scraped={props.scraped}
				keyboard={props.keyboard}
				onTab={() => logInButton.focus()}
			/></p>
			<button disabled={loggingIn()} ref={logInButton}>Log in</button>
			<Show when={error() !== ""}>
				<span class="error" onClick={() => setError("")}>{" " + error()}</span>
			</Show>
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

function CreateAccount(props: {
	onCreated: (account: { name: string, password: string }) => void,
	keylogged: boolean,
	scraped: boolean,
	keyboard: Keyboard,
}): JSX.Element {
	const [error, setError] = createSignal("");
	const [password, setPassword] = createSignal("");
	const [confirmPassword, setConfirmPassword] = createSignal("");
	createEffect(on([password, confirmPassword], () => setError("")));

	let confirmPasswordInput!: PasswordInput;
	let createAccountButton!: HTMLButtonElement;

	return <form action="javascript:void(0)" onSubmit={e => {
		if (password() === "") {
			setError("Enter a password");
			return;
		}
		if (password() !== confirmPassword()) {
			setError("Passwords do not match");
			return;
		}

		const elements = (e.target as HTMLFormElement).elements;
		props.onCreated({
			name: (elements.namedItem("name") as HTMLInputElement).value,
			password: password(),
		});
	}}>
		<h1>Create an account</h1>
		<p><label>Name: <input type="text" name="name" required maxlength="255" /></label></p>
		<p><PasswordInput
			label="Password: "
			value={password()}
			setValue={setPassword}
			keylogged={props.keylogged}
			scraped={props.scraped}
			keyboard={props.keyboard}
			onTab={() => confirmPasswordInput.focus() || createAccountButton.focus()}
		/></p>
		<p><PasswordInput
			label="Confirm password: "
			value={confirmPassword()}
			setValue={setConfirmPassword}
			keylogged={props.keylogged}
			scraped={props.scraped}
			keyboard={props.keyboard}
			onTab={() => createAccountButton.focus()}
			ref={confirmPasswordInput}
		/></p>
		<button ref={createAccountButton}>Create account</button>
		<Show when={error() !== ""}>
			<span class="error" onClick={() => setError("")}>{" " + error()}</span>
		</Show>
	</form>;
}

function ImportAccount(props: { onImport: (account: LockedAccount) => void }): JSX.Element {
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

	return <form action="javascript:void(0)" onSubmit={() => {
		const account_ = account();
		if (account_ instanceof LockedAccount) {
			props.onImport(account_);
		}
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
					<button>Import new account</button>
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

function Settings(props: {
	keylogged: boolean,
	scraped: boolean,
	setKeylogged: (v: boolean) => void,
	setScraped: (v: boolean) => void,
}): JSX.Element {
	return <>
		<h1>Settings</h1>
		<p><label>
			Enable keylogger protection:
			<input
				type="checkbox"
				checked={props.keylogged}
				onInput={e => props.setKeylogged((e.target as HTMLInputElement).checked)}
			/>
		</label></p>
		<p><label>
			Enable scraper protection:
			<input
				type="checkbox"
				checked={props.scraped}
				onInput={e => props.setScraped((e.target as HTMLInputElement).checked)}
			/>
		</label></p>
		<Show when={process.env.NODE_ENV !== "production"}>
			<button type="button" onClick={() => void runTests()}>Run tests</button>
		</Show>
	</>;
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
