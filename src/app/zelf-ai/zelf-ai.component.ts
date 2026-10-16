import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { TranslocoModule, TranslocoService } from "@jsverse/transloco";
import { Subject, distinctUntilChanged, filter, map, skip, takeUntil } from "rxjs";

import { ChromeService } from "app/chrome.service";
import { TagModel } from "app/tags.service";
import { WalletService } from "app/wallet.service";
import { ZaiCard, ZaiError, ZaiHistoryItem, ZaiService } from "app/zai/zai.service";
import { ZelfFooterComponent } from "app/zelf-footer/zelf-footer.component";
import { environment } from "environments/environment";

export interface ZaiMessage {
    role: "user" | "assistant";
    content: string;
    streaming?: boolean;
    cards?: ZaiCard[];
    filtered?: boolean;
    error?: boolean;
}

type ZaiState = "ready" | "unavailable" | "locked";

const MAX_TURNS = 20;
const MAX_CARDS_PER_REPLY = 12;

@Component({
    selector: "zelf-ai",
    standalone: true,
    imports: [CommonModule, FormsModule, TranslocoModule, ZelfFooterComponent],
    styleUrls: ["./zelf-ai.component.scss"],
    templateUrl: "./zelf-ai.component.html",
})
export class ZelfAiComponent implements OnInit, OnDestroy {
    @ViewChild("scroller") private _scroller?: ElementRef<HTMLDivElement>;

    private readonly _destroy$ = new Subject<void>();
    private _abort?: AbortController;
    private _conversationId = this._uuid();

    wallet: Partial<TagModel> = {};
    messages: ZaiMessage[] = [];
    draft = "";
    sending = false;
    state: ZaiState = "ready";
    retryAfter = 0;

    readonly suggestionKeys = ["zai.suggest_balances", "zai.suggest_recover", "zai.suggest_face"];

    constructor(
        private readonly _changeDetectorRef: ChangeDetectorRef,
        private readonly _chromeService: ChromeService,
        private readonly _route: ActivatedRoute,
        private readonly _router: Router,
        private readonly _translocoService: TranslocoService,
        private readonly _walletService: WalletService,
        private readonly _zaiService: ZaiService
    ) {}

    async ngOnInit(): Promise<void> {
        await this._initWallet();
        this._initSubscriptions();

        // Dev-only preview with sample data (used for screenshots); never in production builds.
        const preview = this._route.snapshot.queryParamMap.get("preview");
        if (!(environment as any).production && preview) {
            this._loadPreview(preview);
            return;
        }

        if (!(await this._zaiService.hasIdentity())) this.state = "locked";
        this._changeDetectorRef.detectChanges();
    }

    ngOnDestroy(): void {
        this._abort?.abort();
        this._destroy$.next();
        this._destroy$.complete();
    }

    get walletName(): string {
        return (this.wallet?.fullTagName || this.wallet?.publicData?.tagName || "") as string;
    }

    get canSend(): boolean {
        return !!this.draft.trim() && !this.sending && this.state === "ready";
    }

    onKeydown(event: KeyboardEvent): void {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void this.send();
        }
    }

    askSuggestion(key: string): void {
        this.draft = this._translocoService.translate(key);
        void this.send();
    }

    newConversation(): void {
        this._abort?.abort();
        this.messages = [];
        this._conversationId = this._uuid();
        this.sending = false;
    }

    stop(): void {
        this._abort?.abort();
    }

    unlock(): void {
        void this._router.navigate(["/home"]);
    }

    async send(): Promise<void> {
        const text = this.draft.trim().slice(0, 4000);
        if (!text || this.sending) return;

        const history: ZaiHistoryItem[] = this.messages
            .filter((m) => !m.error && m.content)
            .slice(-MAX_TURNS * 2)
            .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

        this.messages.push({ role: "user", content: text });
        const reply: ZaiMessage = { role: "assistant", content: "", streaming: true };
        this.messages.push(reply);
        this.draft = "";
        this.sending = true;
        this._abort = new AbortController();
        this._render();

        try {
            await this._zaiService.chat(
                {
                    conversationId: this._conversationId,
                    message: text,
                    history,
                    locale: this._translocoService.getActiveLang() || "en",
                },
                {
                    onDelta: (delta) => {
                        reply.content += delta;
                        this._render();
                    },
                    onCard: (card) => {
                        this._addCard(reply, card);
                        this._render();
                    },
                    onDone: (done) => {
                        reply.filtered = done?.finishReason === "filtered";
                    },
                },
                this._abort.signal
            );
        } catch (error: any) {
            if (error?.name !== "AbortError") this._handleError(error, reply);
        } finally {
            reply.streaming = false;
            this.sending = false;
            if (!reply.content && !reply.error && !reply.cards?.length) this.messages.splice(this.messages.indexOf(reply), 1);
            this._render();
        }
    }

    private _handleError(error: unknown, reply: ZaiMessage): void {
        const kind = error instanceof ZaiError ? error.kind : "error";
        if (kind === "unavailable") {
            this.state = "unavailable";
            this.messages.splice(this.messages.indexOf(reply), 1);
            return;
        }
        if (kind === "unauthorized") {
            this.state = "locked";
            this.messages.splice(this.messages.indexOf(reply), 1);
            return;
        }
        reply.error = true;
        if (kind === "rate_limited") {
            this.retryAfter = (error as ZaiError).retryAfter || 30;
            reply.content = this._translocoService.translate("zai.error_rate_limited", { seconds: this.retryAfter });
        } else if (kind === "refused") {
            reply.content = this._translocoService.translate("zai.error_refused");
        } else if (kind === "network") {
            reply.content = this._translocoService.translate("zai.error_offline");
        } else {
            reply.content = this._translocoService.translate("zai.error_generic");
        }
    }

    /** Cards arrive as server `card` events (built from tool results); text is never parsed for cards. */
    private _addCard(msg: ZaiMessage, card: ZaiCard): void {
        const cards = msg.cards || (msg.cards = []);
        if (cards.length >= MAX_CARDS_PER_REPLY) return;
        const key = JSON.stringify(card);
        if (cards.some((c) => JSON.stringify(c) === key)) return;
        cards.push(card);
    }

    txDate(ts?: string | null): string {
        if (!ts) return "";
        const d = new Date(ts);
        return isNaN(d.getTime()) ? "" : d.toLocaleDateString(this._translocoService.getActiveLang() || undefined, { month: "short", day: "numeric" });
    }

    usd(value?: number | null): string {
        return typeof value === "number" ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "";
    }

    shortHash(hash: string): string {
        return hash.length > 10 ? `${hash.slice(0, 3)}…${hash.slice(-3)}` : hash;
    }

    private _render(): void {
        this._changeDetectorRef.detectChanges();
        const el = this._scroller?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
    }

    private _loadPreview(mode: string): void {
        if (mode === "unavailable") {
            this.state = "unavailable";
        } else if (mode === "locked") {
            this.state = "locked";
        } else if (mode !== "empty") {
            this.messages = [
                { role: "user", content: "Why did my last transaction fail?" },
                {
                    role: "assistant",
                    content:
                        "Your Solana transfer of 2.5 USDC failed because the wallet didn't have enough SOL to pay the network fee. Add a little SOL and try again.",
                    cards: [
                        {
                            type: "transaction",
                            hash: "4fKx8s9qPsample",
                            chain: "sol",
                            status: "failed",
                            amount: "2.5",
                            symbol: "USDC",
                            timestamp: "2026-10-16T15:00:00Z",
                            explorerUrl: "https://solscan.io/tx/4fKx8s9qPsample",
                        },
                        { type: "balance", chain: "sol", symbol: "SOL", amount: "0.000001", usdValue: 0.0002 },
                        { type: "doc", title: "Network fees", url: "https://docs.zelf.world/docs/fees" },
                    ],
                },
                { role: "user", content: "How much SOL do I need?" },
                { role: "assistant", content: "About 0.000005 SOL covers one transfer, so", streaming: true },
            ];
        }
        this._changeDetectorRef.detectChanges();
    }

    private _uuid(): string {
        return (globalThis.crypto as any)?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    private async _initWallet(): Promise<void> {
        const { wallet } = await this._walletService.getAllWalletsFromStorage();
        this.wallet = wallet || ({} as Partial<TagModel>);
    }

    private _initSubscriptions(): void {
        this._chromeService.onWalletChanged$
            .pipe(
                map((w) => w?.fullTagName ?? ""),
                distinctUntilChanged(),
                filter((tag) => !!tag),
                skip(1),
                takeUntil(this._destroy$)
            )
            .subscribe(async () => {
                const { wallet } = await this._walletService.getAllWalletsFromStorage();
                if (wallet) {
                    this.wallet = wallet;
                    this.newConversation();
                    this._changeDetectorRef.detectChanges();
                }
            });
    }
}
