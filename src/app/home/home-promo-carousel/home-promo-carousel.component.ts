import { CommonModule } from "@angular/common";
import { Component, ElementRef, Input, ViewChild } from "@angular/core";
import { RouterLink } from "@angular/router";
import { TranslocoService } from "@jsverse/transloco";

import { HOME_PROMO_CARDS, HomePromoCard } from "../home-promo-cards";

@Component({
    imports: [CommonModule, RouterLink],
    selector: "home-promo-carousel",
    styleUrls: ["./home-promo-carousel.component.scss"],
    templateUrl: "./home-promo-carousel.component.html",
})
export class HomePromoCarouselComponent {
    @Input() cards: HomePromoCard[] = HOME_PROMO_CARDS;

    constructor(private _transloco: TranslocoService) {}

    label(key: string): string {
        return this._transloco.translate(key);
    }

    @ViewChild("viewport") viewport?: ElementRef<HTMLElement>;

    activeIndex = 0;
    private _pointerStartX = 0;
    private _pointerMoved = false;

    get hasMany(): boolean {
        return this.cards.length > 1;
    }

    onScroll(): void {
        const viewport = this.viewport?.nativeElement;
        if (!viewport || !viewport.clientWidth) return;

        const index = Math.round(viewport.scrollLeft / viewport.clientWidth);
        this.activeIndex = Math.max(0, Math.min(this.cards.length - 1, index));
    }

    goTo(index: number): void {
        const viewport = this.viewport?.nativeElement;
        if (!viewport) {
            this.activeIndex = index;
            return;
        }

        const next = Math.max(0, Math.min(this.cards.length - 1, index));
        viewport.scrollTo({ left: next * viewport.clientWidth, behavior: "smooth" });
        this.activeIndex = next;
    }

    previous(): void {
        this.goTo(this.activeIndex === 0 ? this.cards.length - 1 : this.activeIndex - 1);
    }

    next(): void {
        this.goTo(this.activeIndex === this.cards.length - 1 ? 0 : this.activeIndex + 1);
    }

    onPointerDown(event: PointerEvent): void {
        this._pointerStartX = event.clientX;
        this._pointerMoved = false;
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
}
