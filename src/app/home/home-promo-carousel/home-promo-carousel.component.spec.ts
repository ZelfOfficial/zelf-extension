import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { TranslocoService } from "@jsverse/transloco";

import { TranslocoTestingModule } from "app/testing/transloco-testing.module";

import { HOME_PROMO_CARDS, HomePromoCard } from "../home-promo-cards";
import { HomePromoCarouselComponent } from "./home-promo-carousel.component";

describe("HomePromoCarouselComponent", () => {
    let fixture: ComponentFixture<HomePromoCarouselComponent>;

    const extra: HomePromoCard = {
        id: "extra",
        titleKey: "home_hub.promo_claim_reward_title",
        ctaKey: "home_hub.promo_claim_reward_cta",
        route: "/rewards/daily",
        icon: "star",
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [HomePromoCarouselComponent, TranslocoTestingModule],
            providers: [provideRouter([])],
        }).compileComponents();

        fixture = TestBed.createComponent(HomePromoCarouselComponent);
        const transloco = TestBed.inject(TranslocoService);
        transloco.setTranslation(
            {
                home_hub: {
                    promo_carousel_label: "Promotions",
                    promo_previous: "Previous",
                    promo_next: "Next",
                    promo_placeholder_title: "Password Manager",
                    promo_placeholder_cta: "Explore",
                    promo_change_logo_title: "Change logo",
                    promo_change_logo_cta: "Customize",
                    promo_claim_reward_title: "Claim reward",
                    promo_claim_reward_cta: "Claim",
                },
            },
            "en",
            { merge: true }
        );
        transloco.setActiveLang("en");
    });

    it("renders the configured cards, including change logo and claim reward, with dot indicators", () => {
        fixture.componentInstance.cards = HOME_PROMO_CARDS;
        fixture.detectChanges();

        const cards = fixture.nativeElement.querySelectorAll(".home-promo__card");
        const dots = fixture.nativeElement.querySelectorAll(".home-promo__dot");
        const routes = Array.from(cards).map((card) => (card as HTMLAnchorElement).getAttribute("href"));

        expect(cards.length).toBe(HOME_PROMO_CARDS.length);
        expect(dots.length).toBe(HOME_PROMO_CARDS.length);
        expect(routes).toContain("/zelf-keys");
        expect(routes.some((href) => href?.includes("/settings"))).toBeTrue();
        expect(routes).toContain("/rewards");
        expect(fixture.nativeElement.querySelector(".home-promo__arrow")).not.toBeNull();
    });

    it("moves between cards from the arrows without changing the card list structure", () => {
        fixture.componentInstance.cards = [...HOME_PROMO_CARDS, extra];
        fixture.detectChanges();

        const next = fixture.nativeElement.querySelectorAll(".home-promo__arrow")[1] as HTMLButtonElement;
        next.click();

        expect(fixture.componentInstance.activeIndex).toBe(1);
        expect(fixture.nativeElement.querySelectorAll(".home-promo__card").length).toBe(4);
    });

    it("ignores a click that was a drag", () => {
        fixture.componentInstance.cards = HOME_PROMO_CARDS;
        fixture.detectChanges();

        const card = fixture.nativeElement.querySelector(".home-promo__card") as HTMLElement;
        card.dispatchEvent(new PointerEvent("pointerdown", { clientX: 10, bubbles: true }));
        card.dispatchEvent(new PointerEvent("pointermove", { clientX: 40, bubbles: true }));

        const event = new MouseEvent("click", { bubbles: true, cancelable: true });
        card.dispatchEvent(event);

        expect(event.defaultPrevented).toBeTrue();
    });
});
