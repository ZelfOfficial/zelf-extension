import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { TranslocoModule, TranslocoService } from "@jsverse/transloco";
import { Subject, distinctUntilChanged, filter, map, skip, takeUntil } from "rxjs";

import { ChromeService } from "app/chrome.service";
import { TagModel } from "app/tags.service";
import { WalletService } from "app/wallet.service";
import { ZaiError, ZaiHistoryItem, ZaiService } from "app/zai/zai.service";
import { ZelfFooterComponent } from "app/zelf-footer/zelf-footer.component";
import { environment } from "environments/environment";

export interface ZaiTxCard {
    chain?: string;
    hash: string;
    status: string;
    date?: string;
}

export interface ZaiMessage {
    role: "user" | "assistant";
    content: string;
    streaming?: boolean;
    tool?: string;
    cards?: ZaiTxCard[];
    error?: boolean;
}

type ZaiState = "ready" | "unavailable" | "locked";

const MAX_TURNS = 20;
const TX_TOKEN = /\[\[tx:([^|\]]+)\|([^|\]]+)(?:\|([^|\]]+))?(?:\|([^|\]]+))?\]\]/g;

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
                    onTool: (tool) => {
                        reply.tool = tool.status === "start" ? tool.name : undefined;
                        this._render();
                    },
                    onDelta: (delta) => {
                        reply.tool = undefined;
                        reply.content += delta;
                        this._applyCards(reply);
                        this._render();
                    },
                },
                this._abort.signal
            );
        } catch (error: any) {
            if (error?.name !== "AbortError") this._handleError(error, reply);
        } finally {
            reply.streaming = false;
            reply.tool = undefined;
            this.sending = false;
            if (!reply.content && !reply.error) this.messages.splice(this.messages.indexOf(reply), 1);
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

    /** Pulls [[tx:hash|status|date|chain]] tokens out of the text into inline cards. */
    private _applyCards(msg: ZaiMessage): void {
        const cards: ZaiTxCard[] = [];
        msg.content = msg.content.replace(TX_TOKEN, (_m, hash, status, date, chain) => {
            cards.push({ hash: hash.trim(), status: status.trim(), date: date?.trim(), chain: chain?.trim() });
            return "";
        });
        if (cards.length) msg.cards = [...(msg.cards || []), ...cards];
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
                    cards: [{ hash: "4fKx8s9qP", status: "Failed", date: "Oct 16", chain: "Solana" }],
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
