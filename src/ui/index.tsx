import { Match, Show, Switch } from "solid-js";
import { SetStoreFunction, Store, createStore } from "solid-js/store";
import { createEffect, createSignal } from "solid-js";
import { JSX } from "solid-js";

import { Db, LockedAccount, UnlockedAccount, db } from "../lib";
import Accounts from "./accounts";
import Dashboard from "./dashboard";
import Keyboard from "./keyboard";

import "./base.scss";

export default function(): JSX.Element {
	let keyboardHandle!: Keyboard;
	const keyboard = <Keyboard ref={keyboardHandle} />;
	return <><MainApp keyboard={keyboardHandle} />{keyboard}</>;
}

function MainApp(props: { keyboard: Keyboard }): JSX.Element {
	const [loaded, setLoaded] = createSignal<null | db.LoadError | Db>(null);

	void (async () => {
		try {
			setLoaded(await db.load());
		} catch (e) {
			if (e instanceof db.LoadError) {
				setLoaded(e);
				if (e.isUnexpected()) {
					throw e.cause;
				}
			} else {
				throw e;
			}
		}
	})();

	return <div class="mainApp" style={{ "margin-bottom": `${props.keyboard.height()}px` }}>
		<Switch>
			<Match when={db.disabled()}>
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
			<Match when={loaded() === null}>
				<p>Loading...</p>
			</Match>
			<Match when={loaded() instanceof db.LoadError}>{() => {
				const error = loaded as () => db.LoadError;
				const [detailsShown, setDetailsShown] = createSignal(false);
				return <>
					<p>{error().topMessage()}</p>
					<p>If you know have no useful information stored, you may delete all stored data using this button:</p>
					<button type="button" class="warn" onClick={() => {
						localStorage.removeItem("state");
						setLoaded(db.createDefault());
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
			}}</Match>
			<Match when={true}>
				<LoadedApp initialDb={loaded() as Db} keyboard={props.keyboard} />
			</Match>
		</Switch>
	</div>;
}

export class ReactiveAccount {
	private constructor(
		public locked: () => LockedAccount,
		public setLocked: (updated: LockedAccount) => void,
		public update: (updated: UnlockedAccount) => void,
	) {}

	static new(this: void, account: LockedAccount): ReactiveAccount {
		const [locked, setLocked] = createSignal(account);
		const update = updaterTask(async (updatedAccount: UnlockedAccount) => {
			setLocked(await LockedAccount.lock(updatedAccount));
		});
		return new ReactiveAccount(locked, setLocked, update);
	}
}

function LoadedApp(props: { initialDb: Db, keyboard: Keyboard }): JSX.Element {
	const [accounts, setAccounts] = createSignal(props.initialDb.accounts.map(ReactiveAccount.new));
	const [accountBin, setAccountBin] = createSignal(props.initialDb.accountBin);
	const [keylogged, setKeylogged] = createSignal(props.initialDb.keylogged);
	const [scraped, setScraped] = createSignal(props.initialDb.scraped);

	createEffect(() => {
		db.store({
			accounts: accounts().map(account => account.locked()),
			accountBin: accountBin(),
			keylogged: keylogged(),
			scraped: scraped(),
		});
	});

	const [currentAccount, setCurrentAccount] = createSignal<
		null | [ReactiveAccount, Store<UnlockedAccount>, SetStoreFunction<UnlockedAccount>]
	>(null);

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
					keylogged={keylogged()}
					scraped={scraped()}
					logOut={() => setCurrentAccount(null)}
					keyboard={props.keyboard}
				/>
			</Match>
			<Match when={currentAccount() === null}>
				<Accounts
					accounts={accounts()}
					setAccounts={setAccounts}
					accountBin={accountBin()}
					setAccountBin={setAccountBin}
					onLogin={(account, unlocked) => {
						const [unlockedAccount, setUnlockedAccount] = createStore(unlocked);
						setCurrentAccount([account, unlockedAccount, setUnlockedAccount]);
					}}
					keylogged={keylogged()}
					scraped={scraped()}
					setKeylogged={setKeylogged}
					setScraped={setScraped}
					keyboard={props.keyboard}
				/>
			</Match>
		</Switch>
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
