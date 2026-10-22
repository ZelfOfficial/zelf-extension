import { ethers } from "ethers";
import { firstValueFrom, Subject, takeUntil } from "rxjs";

import { CommonModule } from "@angular/common";
import { Component, OnDestroy, OnInit, ChangeDetectorRef } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, UntypedFormGroup, Validators } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { MatSnackBar } from "@angular/material/snack-bar";
import { ActivatedRoute, NavigationEnd, Router, RouterModule } from "@angular/router";
import { filter } from "rxjs/operators";
import { TranslocoModule, TranslocoService } from "@jsverse/transloco";

import { AssetService } from "app/asset.service";
import { ChromeService } from "app/chrome.service";
import { areSendAddressesSame } from "app/core/utils/same-wallet-address.util";
import { isNativeSuiHolding, sendConfirmNetworkLabel } from "app/core/utils/sui-coin.util";
import { mapTransactionErrorToTranslationKey } from "app/core/utils/user-facing-transaction-error.util";
import { FeeCalculationParams, TransactionFeeEstimate, TransactionParams, TransactionResult } from "app/core/models/transaction-fee.model";
import { AddressMaskPipe } from "app/pipes/address-mask.pipe";
import { BitcoinService, MempoolFeeRates } from "app/services/bitcoin.service";
import { BlockDAGService } from "app/services/blockdag.service";
import { BlockchainTransactionsService } from "app/services/blockchain-transactions.service";
import { SigningAuthorizationService } from "app/services/signing-authorization.service";
import { FACE_ONLY_PASSPHRASE, SigningGateInput, resolveSigningGate, signingNeedsFace } from "app/core/security/signing-gate.util";
import { NetworkName, NetworkService } from "app/services/network.service";
import { TransactionService } from "app/transaction.service";
import { VaultService } from "app/vault.service";
import { TransactionData } from "@shared/types/wallet.types";
import { WalletService } from "app/wallet.service";
import { ZelfLoaderComponent } from "app/zelf-loader/zelf-loader.component";
import { TagModel } from "app/tags.service";
import { TagsService } from "app/tags.service";
import { StellarFeeBreakdown } from "app/services/stellar-send.types";
import { StellarSendSummaryComponent } from "app/stellar-send-summary/stellar-send-summary.component";
import { DisplayAmountPipe, DisplayFiatPipe } from "../pipes/display-number.pipe";
import { previewProofSecurity, proofRequiresPassword } from "app/onboarding-stack";
import { ZelfIdsService } from "app/zelf-ids.service";

@Component({
    imports: [DisplayAmountPipe, DisplayFiatPipe, 
        AddressMaskPipe,
        CommonModule,
        MatButtonModule,
        MatProgressSpinnerModule,
        ReactiveFormsModule,
        RouterModule,
        StellarSendSummaryComponent,
        TranslocoModule,
        ZelfLoaderComponent,
    ],
    selector: "send-confirm",
    styleUrls: ["./send-confirm.component.scss"],
    templateUrl: "./send-confirm.component.html",
})
export class SendConfirmComponent implements OnInit, OnDestroy {
    private _mnemonics: string = "";
    /** Password/PIN typed before this transaction's face step (vault). Only used with a face approval for this tx. */
    private _carriedSecret: string = "";
    private _interval!: ReturnType<typeof setInterval>;
    private _requiresBiometricsInterval?: ReturnType<typeof setInterval>;
    private _intervalTime: number = 30000;
    private _skipPriceFetch: boolean = false;
    private unsubcriber$: Subject<void> = new Subject<void>();

    feeRates: MempoolFeeRates = {
        fastestFee: 0,
        halfHourFee: 0,
        hourFee: 0,
        economyFee: 0,
        minimumFee: 0,
    };

    availableNetworks = [
        { id: "avalanche", name: "Avalanche", symbol: "AVAX" },
        { id: "binance", name: "Binance", symbol: "BNB" },
        { id: "bitcoin", name: "Bitcoin", symbol: "BTC" },
        { id: "blockdag", name: "BlockDAG", symbol: "BDAG" },
        { id: "ethereum", name: "Ethereum", symbol: "ETH" },
        { id: "polygon", name: "Polygon", symbol: "POL" },
        { id: "optimism", name: "Optimism", symbol: "ETH" },
        { id: "arbitrum", name: "Arbitrum", symbol: "ETH" },
        { id: "base", name: "Base", symbol: "ETH" },
        { id: "solana", name: "Solana", symbol: "SOL" },
        { id: "stellar", name: "Stellar", symbol: "XLM" },
        { id: "sui", name: "Sui", symbol: "SUI" },
        { id: "polkadot", name: "Polkadot", symbol: "DOT" },
        { id: "kusama", name: "Kusama", symbol: "KSM" },
    ];

    form!: UntypedFormGroup;
    isNativeAsset: boolean = false;
    loading: boolean;
    networkPrice: number = 0;
    networkToken?: any;
    passwordError: boolean = false;
    passwordSet: boolean = true;
    price: number = 0;
    remainingAttempts: number = 0;
    requiresBiometrics: boolean = false;
    isPinUnlock: boolean = false;
    /** Wallet without password/PIN: face on every send (#88). */
    isFaceOnly: boolean = false;
    selectedFeeRate: number = 0;
    sending: boolean = false;
    showFeeInfo: boolean = false;
    showPassword: boolean = false;
    transactionData!: TransactionData;
    wallet?: TagModel;
    isStealthMode: boolean = false;
    /** Stellar fee preview (native + classic) for confirm UI. */
    stellarFeeBreakdown: StellarFeeBreakdown | null = null;
    /** Dry-run / fee estimate failed. Confirm stays disabled and the chain error is shown. */
    feeError: string | null = null;



    constructor(
        private _activatedRoute: ActivatedRoute,
        private _assetService: AssetService,
        private _bitcoinService: BitcoinService,
        private _blockDAGService: BlockDAGService,
        private _blockchainTransactionsService: BlockchainTransactionsService,
        private _changeDetectorRef: ChangeDetectorRef,
        private _chromeService: ChromeService,
        private _formBuilder: FormBuilder,
        private _networkService: NetworkService,
        private _router: Router,
        private _snackBar: MatSnackBar,
        private _tagsService: TagsService,
        private _transactionService: TransactionService,
        private _translocoService: TranslocoService,
        private _vaultService: VaultService,
        private _walletService: WalletService,
        private _signingAuthorization: SigningAuthorizationService,
        private _zelfIdsService: ZelfIdsService
    ) {
        this.loading = true;
        this.remainingAttempts = this._vaultService.remainingAttempts;

        this._mnemonics = "";
        this._carriedSecret = this._vaultService.password;

        this._vaultService.mnemonic = "";
        this._vaultService.password = "";
        this.passwordSet = false;
    }

    /**
     * Defense in depth: covers manual navigation to /send/confirmation with
     * stale in-memory data where sender and receiver resolve to the same wallet.
     */
    private _isSelfTransfer(): boolean {
        return areSendAddressesSame(
            this.transactionData?.sender?.address,
            this.transactionData?.receiver?.address,
            this.transactionData
        );
    }

    /** #88: binds the face step to this exact transaction (sender, network, receiver, amount, token). */
    private _signingScope(): string {
        return SigningAuthorizationService.scopeFor(this.transactionData as any);
    }

    /** #88: a face step approved for this transaction in this app instance (never a cached session). */
    private _hasSigningGrant(): boolean {
        return this._signingAuthorization.has(this._signingScope());
    }

    async ngOnInit(): Promise<void> {
        this.transactionData = await this._transactionService.getCurrentTransactionData();

        if (this.transactionData && this.transactionData.hasTransactionData && this.transactionData.hasCompletePaymentData) {
            if (this._isSelfTransfer()) {
                this.openErrorSnackBar("errors.same_address");
                this._router.navigate(["/send/transaction"]);
                this.loading = false;
                return;
            }

            this.isStealthMode = localStorage.getItem("isStealthMode") === "true";
            await this._initTransactionData();

            // Check if wallet is password-less
            await this._checkPasswordlessWallet();

            // #88: never auto-sign. Only decide what to ask for (password/PIN or face).
            await this._refreshSigningGate();
            this._setRequiresBiometricsInterval();

            this.loading = false;

            return;
        }

        this._router.events
            .pipe(
                filter((event) => event instanceof NavigationEnd),
                takeUntil(this.unsubcriber$)
            )
            .subscribe(() => {
                void this._refreshSigningGate();
            });

        this._transactionService.transactionData$.pipe(takeUntil(this.unsubcriber$)).subscribe(async (transactionData) => {
            this.transactionData = transactionData;

            if (!this.transactionData || !this.transactionData.hasTransactionData) {
                this._router.navigate(["/send"]);

                return;
            }

            if (!this.transactionData.hasCompletePaymentData) {
                this._router.navigate(["/send/transaction"]);

                return;
            }

            if (this._isSelfTransfer()) {
                this.openErrorSnackBar("errors.same_address");
                this._router.navigate(["/send/transaction"]);
                this.loading = false;
                return;
            }

            this.isStealthMode = localStorage.getItem("isStealthMode") === "true";
            await this._initTransactionData();

            // Check if wallet is password-less
            await this._checkPasswordlessWallet();

            // #88: never auto-sign. Only decide what to ask for (password/PIN or face).
            await this._refreshSigningGate();
            this._setRequiresBiometricsInterval();

            this.loading = false;
        });
    }

    ngOnDestroy(): void {
        clearInterval(this._interval);
        if (this._requiresBiometricsInterval) clearInterval(this._requiresBiometricsInterval);

        this.unsubcriber$.next();
        this.unsubcriber$.complete();
    }

    get fiatEconomyFee(): number {
        const calculatedFee = this._bitcoinService.calculateBitcoinTransactionFee(this.feeRates.economyFee, this.networkPrice);

        return calculatedFee.fiatFee;
    }

    get fiatFastestFee(): number {
        const calculatedFee = this._bitcoinService.calculateBitcoinTransactionFee(this.feeRates.fastestFee, this.networkPrice);

        return calculatedFee.fiatFee;
    }

    get fiatFeePrice(): number {
        const amount = Number(this.transactionData.fee) || 0;
        const fiatPrice = this.networkPrice || 0;

        return amount * fiatPrice || Number(this.transactionData.fiatFee) || 0;
    }

    get fiatHalfHourFee(): number {
        const calculatedFee = this._bitcoinService.calculateBitcoinTransactionFee(this.feeRates.halfHourFee, this.networkPrice);

        return calculatedFee.fiatFee;
    }

    get fiatPrice(): number {
        const amount = Number(this.transactionData.amount) || 0;
        const fiatPrice = this.price || 0;

        return amount * fiatPrice || amount * Number(this.transactionData.token.price || 0) || 0;
    }

    get hasBalance(): boolean {
        const tokenBalance = Number(this.transactionData.token.balance) || 0;
        const tokenAmount = Number(this.transactionData.token.amount) || 0;
        const sendAmount = Number(this.transactionData.amount) || 0;
        const feeAmount = Number(this.transactionData.fee) || 0;

        const canCoverTokenBalance = tokenBalance > 0 && sendAmount <= tokenBalance;

        if (this.transactionData.network === "sui" && this.isNativeAsset && this.feeError) return false;

        if (this.isNativeAsset) {
            const canCoverTotal = sendAmount + feeAmount <= tokenAmount;
            return canCoverTokenBalance && canCoverTotal;
        }

        const canCoverNetworkFee = this.networkToken?.balance > 0 && feeAmount <= Number(this.networkToken?.balance);

        return canCoverTokenBalance && canCoverNetworkFee;
    }

    /** Blocks confirm when Stellar preview reports an invalid or impossible send. */
    get stellarSendBlocked(): boolean {
        if (this.transactionData?.network !== "stellar") return false;

        const p = this.stellarFeeBreakdown?.preview;

        if (!p) return false;
        if (p.amountBelowMinimum) return true;

        return p.warningKeys.some((k) => k === "classic_fund_first" || k === "classic_trustline" || k === "invalid_amount");
    }

    get networkCurrency(): string {
        return this._networkService.getNetworkSymbol(this.transactionData.network as NetworkName);
    }

    /** Network row. Sui coin types display as Sui, not SUI_TOKEN. */
    get networkLabel(): string {
        return sendConfirmNetworkLabel(this.transactionData.network, this.transactionData.tokenType);
    }

    get total(): number {
        return this.fiatPrice + this.fiatFeePrice || 0;
    }

    get hasCredentials(): boolean {
        // For password-less wallets, credentials are ready if passwordSet is true
        // For password wallets, credentials are ready if password has been entered
        return this.passwordSet || !!this.form.get("password")?.value || !!(this._carriedSecret || "").trim();
    }

    private async _calculateTransactionFee(): Promise<void> {
        this.feeError = null;

        try {
            const amountText = String(this.transactionData.amount ?? "0").replace(/,/g, "").trim();
            const tokenSymbol = this.transactionData.token?.symbol;

            let tokenAddress = this.transactionData.token?.address_token;

            const isNativeToken = ["AVAX", "ETH", "BNB", "MATIC", "BDAG", "XLM", "DOT", "KSM", "APT"].includes(tokenSymbol);

            if (!tokenAddress && this.wallet && this.wallet.publicData?.ethAddress && !isNativeToken) {
                try {
                    // Only fetch data for the specific network/token being sent, not all networks
                    const addressData = await firstValueFrom(this._blockchainTransactionsService.getAddressDataByToken(this.wallet, tokenSymbol));

                    const foundToken = addressData?.[this.transactionData.network]?.data?.tokenHoldings?.tokens.find(
                        (t: any) => t.symbol === tokenSymbol
                    );

                    if (foundToken) tokenAddress = foundToken.address;
                } catch (error) {
                    console.error("Error fetching token data from API:", error);
                }
            }

            const feeParams: FeeCalculationParams = {
                network: this.transactionData.network,
                receiverAddress: this.transactionData.receiver.address,
                amount: Number(amountText),
                tokenType: this.transactionData.tokenType,
                tokenAddress: tokenAddress,
                tokenDecimals: this.transactionData.token.decimals,
                tokenPrice: +this.transactionData.token.price || 0,
                selectedFeeRate: this.selectedFeeRate,
                senderAddress: this.transactionData.sender.address,
                sendAll: this.transactionData.sendAll === true,
                amountText,
            };

            const feeEstimate: TransactionFeeEstimate = await this._blockchainTransactionsService.calculateTransactionFees(feeParams);

            this.transactionData.fee = feeEstimate.fee;
            this.transactionData.fiatFee = feeEstimate.fiatFee;
            this.transactionData.total = feeEstimate.total;

            if (feeEstimate.adjustedAmount) {
                this.transactionData.amount = feeEstimate.adjustedAmount;
                this.transactionData.sendAll = true;
            }

            if (feeEstimate.networkPrice !== undefined) {
                this.networkPrice = feeEstimate.networkPrice;
            }

            this.stellarFeeBreakdown =
                this.transactionData.network === "stellar" && feeEstimate.stellar ? feeEstimate.stellar : null;

            await this._transactionService.setCurrentTransactionData(this.transactionData);
        } catch (error) {
            console.error("Error calculating transaction fee:", error);
            if (this.transactionData?.network === "stellar") {
                this.stellarFeeBreakdown = null;
            }
            if (this.transactionData?.network === "sui") {
                this.feeError = error instanceof Error && error.message ? error.message : "Sui fee estimate failed";
                this.transactionData.fee = 0;
                this.transactionData.fiatFee = 0;
            }
        }
    }

    /** #88: inputs for the shared signing rule. */
    private async _signingGateInput(): Promise<SigningGateInput> {
        return {
            faceOnly: this.isFaceOnly,
            hasVaultKeys: !!(this.wallet?.pgp?.encryptedMessage && this.wallet?.pgp?.privateKey),
            windowOpen: !(await this._vaultService.biometricsRequired()),
            faceApproved: this._hasSigningGrant(),
            typedSecret: this.form?.get("password")?.value || "",
            carriedSecret: this._carriedSecret,
        };
    }

    /** Which button (Verify = face / Confirm) and whether the password/PIN field is shown. Never decrypts. */
    private async _refreshSigningGate(): Promise<void> {
        const input = await this._signingGateInput();

        this.requiresBiometrics = signingNeedsFace(input);
        this.passwordSet = this.isFaceOnly || (input.faceApproved && input.hasVaultKeys && !!(input.carriedSecret || "").trim());

        this._changeDetectorRef.detectChanges();
    }

    /** Decrypts the local seed with this passphrase. Wrong passphrase / expired keys: returns "" and nothing is signed. */
    private async _decryptSeed(passphrase: string): Promise<string> {
        const encryptedMessage = this.wallet?.pgp?.encryptedMessage as string;
        const privateKeyArmoured = this.wallet?.pgp?.privateKey as string;

        try {
            const raw = await this._vaultService.decryptMessage(encryptedMessage, privateKeyArmoured, passphrase);
            const mnemonic = JSON.parse(raw)?.mnemonic?.trim()?.toLowerCase() || "";

            this.passwordError = false;

            return mnemonic;
        } catch (error: any) {
            this._carriedSecret = "";
            this.form?.get("password")?.setValue("");
            this.wallet = ((await this._walletService.getCurrentWallet()) as TagModel) || this.wallet;
            this.remainingAttempts = this._vaultService.remainingAttempts;

            const expired = error === "expired" || error?.message === "expired";
            const keysGone = !this.wallet?.pgp?.encryptedMessage || !this.wallet?.pgp?.privateKey;

            this.passwordError = !expired && !keysGone && !this.isFaceOnly;

            if (expired || keysGone) this.openErrorSnackBar("errors.private_key_locked");

            await this._refreshSigningGate();

            return "";
        }
    }

    async _fetchTokenPrice(): Promise<void> {
        if (this._skipPriceFetch) return;

        try {
            if (this.transactionData.isBDAGToken) {
                this.price = await this._blockDAGService.getCurrentPrice();
                return;
            }

            const response = await this._assetService.fetchAssetPrice(this.transactionData.symbol);

            if (!response?.data || !response?.data?.length) return;

            this.price = response.data[0].open;
        } catch (error: any) {
            // Don't block the flow if price fetching fails
            console.warn("Price fetch failed (non-blocking):", error?.message || error);
            if (error?.status === 400 || error?.status === 404) this._skipPriceFetch = true;
            // Silently continue - price is optional
        }
    }

    private async _getNetworkToken(): Promise<void> {
        const network = this.transactionData.network?.toLowerCase() as NetworkName | "bitcoin";

        const sessionTokens = await this._assetService.loadTokensFromSession();

        // Native SUI is isNative / tokenType SUI / coin type 0x2::sui::SUI, never the symbol alone.
        const suiNative = network === "sui" && isNativeSuiHolding(this.transactionData.token);
        const isNativeToken =
            network === "sui"
                ? suiNative
                : ["AVAX", "ETH", "BNB", "MATIC", "BDAG", "BTC", "SOL", "XLM", "DOT", "KSM", "APT"].includes(this.transactionData.token?.symbol || "");

        if (network === "sui") this.isNativeAsset = suiNative;

        if (!sessionTokens || sessionTokens.length === 0) {
            if (!this.wallet) {
                this.networkToken = null;

                return;
            }

            // Skip fetching all network data for native tokens - we don't need it!
            if (!isNativeToken) {
                try {
                    const response = await firstValueFrom(this._blockchainTransactionsService.getAddressData(this.wallet));
                    const result = await this._assetService.processTokensFromResponse(response);

                    await this._assetService.saveTokensToSession(result.tokens);
                } catch (error) {
                    console.error("Error fetching tokens for network token balance:", error);
                }
            }
        }

        this.networkToken = await this._networkService.getNetworkToken(network as NetworkName);
        this.isNativeAsset =
            network === "sui" ? suiNative : isNativeToken || network === this.networkToken?.name?.toLowerCase() || network === "bitcoin";

        if (network !== "bitcoin" && network !== "blockdag") return;

        try {
            if (network === "blockdag") {
                this.networkPrice = await this._blockDAGService.getCurrentPrice();
                return;
            }

            const response = await this._assetService.fetchAssetPrice("BTC");

            if (response?.data?.length) this.networkPrice = response.data[0].open;
        } catch (error) {
            console.error("Error fetching network price:", error);
        }
    }

    private _initForm(): void {
        this.form = this._formBuilder.group({
            password: ["", [Validators.required]],
        });
    }

    async _initFeeRates(): Promise<void> {
        if (this.transactionData.network !== "bitcoin") return;

        this.feeRates = await this._bitcoinService.getFeeRates();
        this.selectedFeeRate = this._bitcoinService.selectedFeeRate;

        if (this.selectedFeeRate === 0) {
            this.selectedFeeRate = this.feeRates.halfHourFee;

            return;
        }

        const keys = ["minimumFee", "economyFee", "hourFee", "halfHourFee", "fastestFee"];

        let lastFeeRate: number = 0;

        for (const key of keys) {
            const feeRate = this.feeRates[key as keyof MempoolFeeRates];

            if (feeRate === this.selectedFeeRate) {
                this.selectedFeeRate = feeRate;

                break;
            } else if (feeRate > this.selectedFeeRate || key === "fastestFee") {
                this.selectedFeeRate = lastFeeRate;

                break;
            } else {
                lastFeeRate = feeRate;
            }
        }
    }

    async _initInterval(): Promise<void> {
        clearInterval(this._interval);

        this._interval = setInterval(() => {
            this._calculateTransactionFee();
            this._fetchTokenPrice();
        }, this._intervalTime);
    }

    private async _initTransactionData(): Promise<void> {
        this.wallet = (await this._walletService.getCurrentWallet()) as TagModel;
        this.transactionData = await this._transactionService.getCurrentTransactionData();

        this._initInterval();

        this._initForm();

        await this._initFeeRates();
        await this._getNetworkToken();
        await this._fetchTokenPrice();
        await this._calculateTransactionFee();
    }

    private async _checkPasswordlessWallet(): Promise<void> {
        if (!this.wallet?.publicData) return;

        const publicData = this.wallet.publicData as any;

        let requiresPassword: boolean | undefined =
            publicData.hasPassword === "true" ? true : publicData.hasPassword === "false" ? false : undefined;

        if (requiresPassword === undefined) {
            try {
                const zelfProof = (await this._tagsService.getZelfProof()) || this.wallet.zelfProof || "";

                if (zelfProof) {
                    const preview = await previewProofSecurity(
                        zelfProof,
                        (proof) => this._zelfIdsService.previewZelfProof({ zelfProof: proof, os: "DESKTOP" }),
                        (proof) => this._tagsService.previewZelfProof({ zelfProof: proof, os: "DESKTOP" })
                    );

                    requiresPassword = proofRequiresPassword(preview?.passwordLayer, publicData?.hasPassword);
                }
            } catch {
                // Unknown metadata: treat as password wallet (never skip the password field).
            }
        }

        // Always set securityType from this wallet (parity with dapp-sign) so biometrics
        // does not reuse a stale withoutPassword / password flag from another ID.
        this.isFaceOnly = requiresPassword === false;

        if (this.isFaceOnly) {
            this._vaultService.securityType = "withoutPassword";
            this.requiresBiometrics = true;
            this.passwordSet = true;
        } else if (publicData.st === "pin") {
            this.isPinUnlock = true;
            this._vaultService.securityType = "pin";
        } else {
            this._vaultService.securityType = "password";
        }

        this._changeDetectorRef.detectChanges();
    }

    /** Password/PIN to send with the face decrypt API (form, then carried from the pre-face step). */
    private _passwordForFaceStep(): string {
        if (this.isFaceOnly) return FACE_ONLY_PASSPHRASE;

        const typed = (this.form?.get("password")?.value || "").trim();

        if (typed) return typed;

        return (this._carriedSecret || "").trim();
    }

    private _setRequiresBiometricsInterval(): void {
        if (this._requiresBiometricsInterval) clearInterval(this._requiresBiometricsInterval);

        this._requiresBiometricsInterval = setInterval(() => {
            void this._signingGateInput().then((input) => {
                this.requiresBiometrics = signingNeedsFace(input);
                this._changeDetectorRef.detectChanges();
            });
        }, 1000);
    }

    /** Starts the face step; never opens biometrics without a password when the wallet has one. */
    private async _beginFaceStep(): Promise<boolean> {
        await this._checkPasswordlessWallet();

        const secret = this._passwordForFaceStep();

        if (!this.isFaceOnly && !secret) {
            this.passwordSet = false;
            await this._refreshSigningGate();
            this.openErrorSnackBar("errors.empty_password");

            return false;
        }

        this._vaultService.password = secret;

        if (!this.isFaceOnly) {
            this._carriedSecret = secret;
        }

        await this._tagsService.setTagName(this.transactionData.sender.tagName);

        await this._tagsService.setFlow("unlock");

        // #88: the biometrics screen can only authorize the transaction that started it.
        this._signingAuthorization.requestAuthorization(this._signingScope());

        this._router.navigate(["security/biometrics"], { queryParams: { return: "/send/confirmation" } });

        return true;
    }

    async _redirectToBiometrics(): Promise<void> {
        await this._beginFaceStep();
    }

    async confirmTransaction() {
        if (this.sending || this.feeError) return;

        // #88 signing rule: see core/security/signing-gate.util.ts.
        const gate = resolveSigningGate(await this._signingGateInput());

        if (gate.action === "ask-secret") {
            this._mnemonics = "";
            await this._refreshSigningGate();
            this.openErrorSnackBar("errors.empty_password");

            return;
        }

        if (gate.action === "face") {
            this._mnemonics = "";
            this.requiresBiometrics = true;
            await this._beginFaceStep();

            return;
        }

        // One-time face approval for this exact transaction (face-only wallets, and right after a face step).
        if (gate.consumeApproval && !this._signingAuthorization.consume(this._signingScope())) {
            this._mnemonics = "";
            this._signingAuthorization.revoke();
            this._carriedSecret = "";
            this.passwordSet = false;
            this.requiresBiometrics = true;
            await this._refreshSigningGate();
            this.openErrorSnackBar("errors.empty_password");

            return;
        }

        this._mnemonics = await this._decryptSeed(gate.passphrase);

        if (!this._mnemonics) return;

        this.sending = true;

        try {
            const cleanMnemonic = this._mnemonics.trim().toLowerCase();
            const amountText = String(this.transactionData.amount ?? "0").replace(/,/g, "").trim();
            const normalizedAmount = Number(amountText);

            await this._handleStandardTransaction(cleanMnemonic, normalizedAmount, amountText);
        } catch (error: unknown) {
            console.error("Send transaction failed", error);
            this.openErrorSnackBar(mapTransactionErrorToTranslationKey(error));

            this.sending = false;
        } finally {
            this._mnemonics = "";
            this._carriedSecret = "";
        }
    }

    async goBack(): Promise<void> {
        if (this.showFeeInfo) {
            this.showFeeInfo = false;

            return;
        }

        this._vaultService.password = "";
        this._vaultService.mnemonic = "";
        this._signingAuthorization.revoke();

        this.transactionData.fee = 0;
        this.transactionData.fiatFee = 0;
        this.transactionData.total = 0;

        await this._transactionService.setCurrentTransactionData(this.transactionData);

        // Don't clear stealth mode flag here - let user keep their selection
        this._router.navigate(["/send/transaction"]);
    }

    async goToBiometrics(): Promise<void> {
        if (!this.wallet) return;

        if (!this.isFaceOnly && !this._passwordForFaceStep()) {
            await this._refreshSigningGate();
            this.openErrorSnackBar("errors.empty_password");

            return;
        }

        if (!this.hasCredentials) return;

        await this._beginFaceStep();
    }

    openErrorSnackBar(message: string): void {
        this._snackBar.open(this._translocoService.translate(message), this._translocoService.translate("common.close"), {
            duration: 5000,
            panelClass: "zelf-snackbar",
            verticalPosition: "top",
        });
    }

    openFeeInfo(): void {
        this.showFeeInfo = true;
    }

    selectFeeRate(feeRate: number): void {
        this.showFeeInfo = false;
        this.selectedFeeRate = feeRate;

        this._calculateTransactionFee();
    }

    toggleShowPassword(): void {
        this.showPassword = !this.showPassword;
    }

    /**
     * Handle standard (non-stealth) transaction for all networks
     * @private
     */
    private async _handleStandardTransaction(cleanMnemonic: string, normalizedAmount: number, amountText?: string): Promise<void> {
        const exactAmount = (amountText || String(normalizedAmount)).replace(/,/g, "").trim();
        const transactionParams: TransactionParams = {
            from: "",
            to: this.transactionData.receiver.address,
            value: this.transactionData.network === "sui" ? exactAmount : String(normalizedAmount),
            network: this.transactionData.network,
            mnemonic: cleanMnemonic,
            tokenAddress: this.transactionData.token?.address_token || this.transactionData.token?.tokenAddress,
            tokenDecimals: this.transactionData.token?.decimals,
            memo: this.transactionData.memo?.trim() || undefined,
            sendAll: this.transactionData.sendAll === true,
        };

        // EVM networks need private key instead of mnemonic
        if (["ethereum", "avalanche", "binance", "blockdag", "polygon", "optimism", "arbitrum", "base"].includes(this.transactionData.network)) {
            if (!ethers.Mnemonic.isValidMnemonic(cleanMnemonic)) {
                this.openErrorSnackBar("errors.invalid_private_key");
                return;
            }

            const wallet = ethers.Wallet.fromPhrase(cleanMnemonic);
            transactionParams.privateKey = wallet.privateKey;
            transactionParams.from = wallet.address;
            delete transactionParams.mnemonic;
        }

        // Send transaction via blockchain service
        const result: TransactionResult = await this._blockchainTransactionsService.sendTransaction(transactionParams);

        await this._finalizeStandardTransaction(result);
    }

    /**
     * Finalize standard transaction and navigate to confirmation
     * @private
     */
    private async _finalizeStandardTransaction(result: TransactionResult): Promise<void> {
        const receipt = {
            transactionHash: result.hash,
            hash: result.hash,
            digest: result.hash,
            network: this.transactionData.network,
            tokenType: this.transactionData.tokenType,
            fee: this.transactionData.fee,
            fiatFee: this.transactionData.fiatFee,
            total: this.transactionData.total,
            status: result.status,
        };

        this._transactionService.addToRecentAddresses({
            address: this.transactionData.receiver.address,
            tagName: this.transactionData.receiver.tagName,
            domain: this.transactionData.receiver.domain,
            network: this.transactionData.network,
            tokenType:
                this.transactionData.network === "sui"
                    ? "SUI"
                    : this.transactionData.network === "stellar"
                      ? "XLM"
                      : this.transactionData.network === "avalanche"
                        ? "AVAX"
                        : this.transactionData.network === "bitcoin"
                          ? "BTC"
                          : this.transactionData.network === "polkadot"
                            ? "DOT"
                            : this.transactionData.network === "kusama"
                              ? "KSM"
                              : this.transactionData.network === "aptos"
                                ? "APT"
                                : this.transactionData.tokenType,
        });

        this.sending = false;

        const sendDateTime = new Date().toISOString();
        const pendingTransactionData = {
            ...this.transactionData,
            ...receipt,
            amount: this.transactionData.amount,
            total: this.transactionData.total,
            fee: this.transactionData.fee,
            date: sendDateTime,
            from: this.transactionData.sender.address,
            network: this.transactionData.network,
            status: receipt.status,
            to: this.transactionData.receiver.address,
            tokenType: this.transactionData.tokenType,
        };

        await this._walletService.addTransactionToPending(pendingTransactionData);
        await this._transactionService.removeTransactionData();
        await this._chromeService.removeItemSession("tokensTtl");

        await this._router.navigate(["/transaction", receipt.transactionHash], {
            queryParams: {
                network: this.transactionData?.network,
                symbol: this.transactionData?.tokenType,

            },
        });
    }

}
