import { ComponentFixture, discardPeriodicTasks, fakeAsync, TestBed, tick } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { TranslocoService } from "@jsverse/transloco";

import { TranslocoTestingModule } from "app/testing/transloco-testing.module";

import { HOME_PROMO_CARDS, HomePromoCard } from "../home-promo-cards";
import { HomePromoCarouselComponent } from "./home-promo-carousel.component";
import { nextPromoIndex, PROMO_AUTO_ADVANCE_MS } from "./home-promo-carousel.logic";

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
                    promo_claim_reward_title: "Claim rewards",
                    promo_claim_reward_subtitle: "Get $ZNS daily with our quests",
                    promo_claim_reward_cta: "Claim",
                },
            },
            "en",
            { merge: true }
        );
        transloco.setActiveLang("en");
    });

    afterEach(() => {
        fixture.destroy();
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

        const reward = fixture.nativeElement.querySelector('a[href="/rewards"]') as HTMLElement;
        const chest = reward.querySelector("img") as HTMLImageElement;
        const rewardCard = HOME_PROMO_CARDS.find((card) => card.id === "claim-reward");
        expect(chest.getAttribute("src")).toContain("rewards-chest.svg");
        expect(reward.querySelector(".home-promo__subtitle")).not.toBeNull();
        expect(reward.querySelector(".home-promo__cta")).toBeNull();
        expect(reward.querySelector(".home-promo__chevron")).not.toBeNull();
        expect(reward.classList.contains("home-promo__card--leading")).toBeTrue();
        expect(rewardCard?.subtitleKey).toBe("home_hub.promo_claim_reward_subtitle");
        expect(rewardCard?.visualAlign).toBe("start");
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

    it("advances on its own and still moves when the user asks", fakeAsync(() => {
        fixture.componentInstance.cards = HOME_PROMO_CARDS;
        fixture.detectChanges();

        tick(PROMO_AUTO_ADVANCE_MS);
        expect(fixture.componentInstance.activeIndex).toBe(1);

        fixture.componentInstance.next();
        expect(fixture.componentInstance.activeIndex).toBe(2);

        tick(PROMO_AUTO_ADVANCE_MS);
        expect(fixture.componentInstance.activeIndex).toBe(0);
        discardPeriodicTasks();
    }));

    it("pauses automatic movement while the pointer is down and resumes after", fakeAsync(() => {
        fixture.componentInstance.cards = HOME_PROMO_CARDS;
        fixture.detectChanges();

        const viewport = fixture.nativeElement.querySelector(".home-promo__viewport") as HTMLElement;
        viewport.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 4 }));
        tick(PROMO_AUTO_ADVANCE_MS);
        expect(fixture.componentInstance.activeIndex).toBe(0);

        document.dispatchEvent(new PointerEvent("pointerup"));
        tick(PROMO_AUTO_ADVANCE_MS);
        expect(fixture.componentInstance.activeIndex).toBe(1);
        discardPeriodicTasks();
    }));

    it("does not advance on its own when reduced motion is requested", fakeAsync(() => {
        spyOn(window, "matchMedia").and.callFake(
            (query: string) =>
                ({
                    matches: query.includes("reduce"),
                    media: query,
                    addEventListener() {},
                    removeEventListener() {},
                    addListener() {},
                    removeListener() {},
                    dispatchEvent() {
                        return false;
                    },
                    onchange: null,
                }) as MediaQueryList
        );

        fixture.detectChanges();
        tick(PROMO_AUTO_ADVANCE_MS);
        expect(fixture.componentInstance.activeIndex).toBe(0);
        fixture.componentInstance.next();
        expect(fixture.componentInstance.activeIndex).toBe(1);
        discardPeriodicTasks();
    }));

    it("stops advancing after the carousel is destroyed", fakeAsync(() => {
        fixture.componentInstance.cards = HOME_PROMO_CARDS;
        fixture.detectChanges();
        fixture.componentInstance.ngOnDestroy();

        tick(PROMO_AUTO_ADVANCE_MS);
        expect(fixture.componentInstance.activeIndex).toBe(0);
        discardPeriodicTasks();
    }));
});

describe("nextPromoIndex", () => {
    it("wraps to the first slide and stays on a single slide", () => {
        expect(nextPromoIndex(0, 3)).toBe(1);
        expect(nextPromoIndex(2, 3)).toBe(0);
        expect(nextPromoIndex(0, 1)).toBe(0);
        expect(PROMO_AUTO_ADVANCE_MS).toBe(5000);
    });
});
