import { For, Match, Show, Switch } from "solid-js";
import { createEffect, createSignal } from "solid-js";
import { JSX } from "solid-js";

import { IncorrectPassword, LockedAccount, TamperedError, UnlockedAccount, createAccount } from "../stored";
import { ReactiveAccount } from ".";

import "./accounts.scss";

export default function(props: {
	accounts: ReactiveAccount[],
	setAccounts: (updater: (old: ReactiveAccount[]) => ReactiveAccount[]) => void,
	onLogin: (i: number, unlocked: UnlockedAccount) => void,
}): JSX.Element {
	const [loggingIn, setLoggingIn] = createSignal<null | number>(null);
	//setLoggingIn(0); // TODO: remove
	const [creatingAccount, setCreatingAccount] = createSignal(false);

	return <div class="accounts">
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
	</div>;
}

function AccountSelection(props: { onSelected: (i: number) => void, accounts: ReactiveAccount[] }): JSX.Element {
	return <>
		<h1>Choose an account</h1>
		<div class="selector">
			<div class="options">
				<For each={props.accounts} fallback={<p>No accounts</p>}>{(account, i) =>
					<AccountOption account={account.locked()} onClick={() => props.onSelected(i())} />
				}</For>
			</div>
		</div>
	</>;
}

function AccountOption(props: { account: LockedAccount, onClick: () => void }): JSX.Element {
	return (
		<div class="account" onClick={props.onClick}>
			<h2>{props.account.publicData.name}</h2>
			<p>{props.account.publicData.dsaPublicKey.toString()}</p>
		</div>
	);
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
		<label>Name: <input type="text" name="name" required maxlength="255" /></label>
		<label>Password: <input type="password" name="password" required /></label>
		<button>Create account</button>
	</form>;
}

function Login(props: {
	account: LockedAccount,
	onSuccess: (unlocked: UnlockedAccount) => void,
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
	//void (async () => {
	//	props.onSuccess(await props.account.unlock("a"));
	//})();

	return <form action="javascript:void(0)" onSubmit={e => {
		const elements = (e.target as HTMLFormElement).elements;
		const password = (elements.namedItem("password") as HTMLInputElement).value;

		void (async () => {
			try {
				props.onSuccess(await props.account.unlock(password));
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
		<p><label>Nickname: {props.account.publicData.name}</label></p>
		<p><label>Password: <input type="password" name="password" required /></label></p>
		<button disabled={loggingIn()}>Log in</button>
		<Show when={error() !== ""}><p class="error">{error()}</p></Show>
	</form>;
}
