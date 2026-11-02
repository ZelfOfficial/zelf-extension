import { prepareTransactionForSigning, Web3Eth } from "web3-eth";
import Contract from "web3-eth-contract";
import { privateKeyToAccount, signTransaction } from "web3-eth-accounts";
import { ETH_DATA_FORMAT } from "web3-types";
import { format } from "web3-utils";
import * as web3Utils from "web3-utils";

/**
 * The `web3` package's browser build defaults to a paid RPC provider and embeds its hostnames.
 * This facade keeps the `eth` / `utils` calls the wallet already makes, using `web3-eth` directly.
 */
type WalletAccounts = {
    privateKeyToAccount: (privateKey: string) => {
        address: string;
        privateKey: string;
        signTransaction: (transaction: Record<string, unknown>) => Promise<{ rawTransaction: string }>;
    };
    signTransaction: (transaction: Record<string, unknown>, privateKey: string) => Promise<{ rawTransaction: string }>;
};

export type WalletWeb3Eth = Web3Eth & {
    Contract: new (jsonInterface: unknown, address?: string) => InstanceType<typeof Contract>;
    accounts: WalletAccounts;
};

async function signWithContext(context: Web3Eth, transaction: Record<string, unknown>, privateKey: string) {
    const prepared = await prepareTransactionForSigning(transaction as never, context);
    const privateKeyBytes = format({ format: "bytes" }, privateKey, ETH_DATA_FORMAT);

    return signTransaction(prepared, privateKeyBytes);
}

function accountsFor(context: Web3Eth): WalletAccounts {
    return {
        privateKeyToAccount(privateKey: string) {
            const account = privateKeyToAccount(privateKey);

            return {
                ...account,
                signTransaction: (transaction: Record<string, unknown>) => signWithContext(context, transaction, account.privateKey),
            };
        },
        signTransaction(transaction: Record<string, unknown>, privateKey: string) {
            return signWithContext(context, transaction, privateKey);
        },
    };
}

export default class Web3 {
    readonly eth: WalletWeb3Eth;
    readonly utils = web3Utils;

    constructor(provider?: unknown) {
        if (provider === undefined) {
            this.eth = undefined as unknown as WalletWeb3Eth;

            return;
        }

        const eth = new Web3Eth(provider as ConstructorParameters<typeof Web3Eth>[0]) as WalletWeb3Eth;

        eth.accounts = accountsFor(eth);
        eth.Contract = function BoundContract(this: unknown, jsonInterface: unknown, address?: string) {
            return new Contract(jsonInterface as never, address, eth);
        } as unknown as WalletWeb3Eth["Contract"];
        this.eth = eth;
    }
}
