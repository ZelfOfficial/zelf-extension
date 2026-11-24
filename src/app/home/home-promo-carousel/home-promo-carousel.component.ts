import { CommonModule } from "@angular/common";
import { Component, ElementRef, Input, OnChanges, OnDestroy, OnInit, ViewChild } from "@angular/core";
import { RouterLink } from "@angular/router";
import { TranslocoService } from "@jsverse/transloco";

import { HOME_PROMO_CARDS, HomePromoCard } from "../home-promo-cards";
import { nextPromoIndex, PROMO_AUTO_ADVANCE_MS } from "./home-promo-carousel.logic";

@Component({
    imports: [CommonModule, RouterLink],
    selector: "home-promo-carousel",
    styleUrls: ["./home-promo-carousel.component.scss"],
    templateUrl: "./home-promo-carousel.component.html",
})
export class HomePromoCarouselComponent implements OnInit, OnChanges, OnDestroy {
    @Input() cards: HomePromoCard[] = HOME_PROMO_CARDS;

    constructor(private _transloco: TranslocoService) {}

    label(key: string): string {
        return this._transloco.translate(key);
    }

    @ViewChild("viewport") viewport?: ElementRef<HTMLElement>;

    activeIndex = 0;
    private _pointerStartX = 0;
    private _pointerMoved = false;
    private _interacting = false;
    private _autoTimer: ReturnType<typeof setInterval> | null = null;
    private readonly _endInteraction = (): void => this.onPointerUp();
    private readonly _onVisibility = (): void => {
        if (document.hidden) this._clearAuto();
        else this._armAuto();
    };

    get hasMany(): boolean {
        return this.cards.length > 1;
    }

    ngOnInit(): void {
        document.addEventListener("pointerup", this._endInteraction);
        document.addEventListener("pointercancel", this._endInteraction);
        document.addEventListener("visibilitychange", this._onVisibility);
        this._armAuto();
    }

    ngOnChanges(): void {
        if (this.activeIndex > this.cards.length - 1) this.activeIndex = 0;
        this._armAuto();
    }

    ngOnDestroy(): void {
        document.removeEventListener("pointerup", this._endInteraction);
        document.removeEventListener("pointercancel", this._endInteraction);
        document.removeEventListener("visibilitychange", this._onVisibility);
        this._clearAuto();
    }

    onScroll(): void {
        const viewport = this.viewport?.nativeElement;
        if (!viewport || !viewport.clientWidth) return;

        const index = Math.round(viewport.scrollLeft / viewport.clientWidth);
        this.activeIndex = Math.max(0, Math.min(this.cards.length - 1, index));
    }

    goTo(index: number, source: "user" | "auto" = "user"): void {
        const viewport = this.viewport?.nativeElement;
        const next = Math.max(0, Math.min(this.cards.length - 1, index));
        if (!viewport) {
            this.activeIndex = next;
        } else {
            viewport.scrollTo({ left: next * viewport.clientWidth, behavior: this._prefersReducedMotion() ? "auto" : "smooth" });
            this.activeIndex = next;
        }

        if (source === "user") this._armAuto();
    }

    previous(): void {
        this.goTo(this.activeIndex === 0 ? this.cards.length - 1 : this.activeIndex - 1);
    }

    next(): void {
        this.goTo(nextPromoIndex(this.activeIndex, this.cards.length));
    }

    onPointerDown(event: PointerEvent): void {
        this._pointerStartX = event.clientX;
        this._pointerMoved = false;
        if (this._interacting) return;

        this._interacting = true;
        this._clearAuto();
    }

    onPointerUp(): void {
        if (!this._interacting) return;

        this._interacting = false;
        this._armAuto();
    }

    onPointerMove(event: PointerEvent): void {
        if (Math.abs(event.clientX - this._pointerStartX) > 8) this._pointerMoved = true;
    }

    onCardClick(event: Event): void {
        if (!this._pointerMoved) return;

        event.preventDefault();
        event.stopPropagation();
        this._pointerMoved = false;
    }

    onKeydown(event: KeyboardEvent): void {
        if (event.key === "ArrowRight") {
            event.preventDefault();
            this.next();
        } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            this.previous();
        }
    }

    trackById(_index: number, card: HomePromoCard): string {
        return card.id;
    }

    private _canAuto(): boolean {
        return this.hasMany && !this._prefersReducedMotion() && !document.hidden && !this._interacting;
    }

    private _prefersReducedMotion(): boolean {
        return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    private _armAuto(): void {
        this._clearAuto();
        if (!this._canAuto()) return;

        this._autoTimer = setInterval(() => {
            if (!this._canAuto()) return;
            this.goTo(nextPromoIndex(this.activeIndex, this.cards.length), "auto");
        }, PROMO_AUTO_ADVANCE_MS);
    }

    private _clearAuto(): void {
        if (!this._autoTimer) return;

        clearInterval(this._autoTimer);
        this._autoTimer = null;
    }
}
