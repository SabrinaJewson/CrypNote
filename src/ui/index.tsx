import { Match, Show, Switch } from "solid-js";
import { SetStoreFunction, Store, createStore } from "solid-js/store";
import { createEffect, createSignal } from "solid-js";
import { JSX } from "solid-js";

import { LoadStoredError, LockedAccount, Stored, UnlockedAccount, defaultStored, disabled, loadStored, storeStored } from "../stored";
import Accounts from "./accounts";
import Dashboard from "./dashboard";
import { runTests } from "../test";

import "./base.scss";

export default function(): JSX.Element {
	const [stored, setStored] = createSignal<null | LoadStoredError | Stored>(null);

	void (async () => {
		try {
			setStored(await loadStored());
		} catch (e) {
			if (e instanceof LoadStoredError) {
				setStored(e);
				if (e.isUnexpected()) {
					throw e.cause;
				}
			} else {
				throw e;
			}
		}
	})();

	return <Switch>
			<Match when={disabled()}>
				<div class="disabled">
					<h1>This website has been opened in another tab.</h1>
					<p>
						Unfortunately, running this website in multiple tabs concurrently is not
						currently supported, and would cause many issues if allowed. Please close this
						or the other tab and then reload.
					</p>
					<button type="button" onClick={() => location.reload()}>Reload</button>
				</div>
			</Match>
			<Match when={stored() === null}>
				<p>Loading...</p>
			</Match>
			<Match when={stored() instanceof LoadStoredError}>{(() => {
				const error = stored as () => LoadStoredError;
				const [detailsShown, setDetailsShown] = createSignal(false);
				return <>
					<p>{error().topMessage()}</p>
					<p>If you know have no useful information stored, you may delete all stored data using this button:</p>
					<button type="button" class="warn" onClick={() => {
						localStorage.removeItem("state");
						setStored(defaultStored());
					}}>Clear all stored data</button>
					<p>
						<button type="button" onClick={() => setDetailsShown(!detailsShown())}>
							{detailsShown() ? "Hide" : "Show"} details
						</button>
					</p>
					<Show when={detailsShown()}>
						<Show when={error().cause instanceof Error}>
							<p>Cause: {(error().cause as Error).toString()}</p>
						</Show>
						<p>Stored: <code>{error().stored}</code></p>
					</Show>
				</>
			})()}</Match>
			<Match when={true}>
				<LoadedApp initialStored={stored() as Stored}/>
			</Match>
	</Switch>;
}

export class ReactiveAccount {
	private constructor(
		public locked: () => LockedAccount,
		public update: (updated: UnlockedAccount) => void,
	) {}

	static new(this: void, account: LockedAccount): ReactiveAccount {
		const [locked, setLocked] = createSignal(account);
		const update = updaterTask(async (updatedAccount: UnlockedAccount) => {
			setLocked(await LockedAccount.lock(updatedAccount));
		});
		return new ReactiveAccount(locked, update);
	}
}

function LoadedApp(props: { initialStored: Stored }): JSX.Element {
	const [accounts, setAccounts] = createSignal(props.initialStored.accounts.map(ReactiveAccount.new));
	const [keylogged, setKeylogged] = createSignal(props.initialStored.keylogged);
	const [scraped, setScraped] = createSignal(props.initialStored.scraped);

	createEffect(() => {
		storeStored({
			accounts: accounts().map(account => account.locked()),
			keylogged: keylogged(),
			scraped: scraped(),
		});
	});

	const [currentAccount, setCurrentAccount] = createSignal<null | [ReactiveAccount, Store<UnlockedAccount>, SetStoreFunction<UnlockedAccount>]>(null);

	createEffect(() => {
		const currentAccount_ = currentAccount();
		if (currentAccount_ !== null) {
			currentAccount_[0].update(currentAccount_[1]);
		}
	});

	return <>
		<Switch>
			<Match when={currentAccount() !== null}>
				<Dashboard
					account={currentAccount()![1]}
					setAccount={currentAccount()![2]}
					scraped={scraped()}
					logOut={() => setCurrentAccount(null)}
				/>
			</Match>
			<Match when={currentAccount() === null}>
				<Accounts
					accounts={accounts()}
					setAccounts={setAccounts}
					onLogin={(i, unlocked) => {
						const [unlockedAccount, setUnlockedAccount] = createStore(unlocked);
						setCurrentAccount([accounts()[i], unlockedAccount, setUnlockedAccount]);
					}}
				/>
			</Match>
		</Switch>

		<div class="floating">
			<p><label>
				Enable keylogger protection:
				<input type="checkbox" checked={keylogged()} onInput={e => setKeylogged((e.target as HTMLInputElement).checked)} />
			</label></p>
			<p><label>
				Enable scraper protection:
				<input type="checkbox" checked={scraped()} onInput={e => setScraped((e.target as HTMLInputElement).checked)} />
			</label></p>
			<button type="button" onClick={() => void runTests()}>Run tests</button>
		</div>
	</>;
}

function updaterTask<T>(fn: (updated: T) => Promise<void>): (updated: T) => void {
	let running = false;
	let toProcess: T | null = null;

	return (updated: T) => {
		toProcess = updated;
		if (!running) {
			void (async () => {
				running = true;
				while (toProcess !== null) {
					const processing = toProcess;
					toProcess = null;
					await fn(processing);
				}
				running = false;
			})();
		}
	};
}
