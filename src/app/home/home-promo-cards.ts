/**
 * Home promo carousel. Add a card here; Home does not hard-code each slide.
 * `route` must be an existing screen.
 */
export interface HomePromoCard {
    id: string;
    titleKey: string;
    ctaKey: string;
    route: string;
    queryParams?: Record<string, string>;
    imageUrl?: string;
    /** Material symbol used when the card has no image. */
    icon?: string;
    /** Secondary line. When set, the card shows this instead of the CTA pill. */
    subtitleKey?: string;
    /** `start` places the artwork on the left, matching the Android rewards card. */
    visualAlign?: "start" | "end";
    /** Trailing chevron, as on the Android promo card. */
    chevron?: boolean;
}

export const HOME_PROMO_CARDS: HomePromoCard[] = [
    {
        id: "zelf-keys",
        titleKey: "home_hub.promo_placeholder_title",
        ctaKey: "home_hub.promo_placeholder_cta",
        route: "/zelf-keys",
        imageUrl: "assets/images/zelf_keys_preview.png",
    },
    {
        id: "change-logo",
        titleKey: "home_hub.promo_change_logo_title",
        ctaKey: "home_hub.promo_change_logo_cta",
        route: "/settings",
        queryParams: { edit: "theme" },
        icon: "palette",
    },
    {
        id: "claim-reward",
        titleKey: "home_hub.promo_claim_reward_title",
        subtitleKey: "home_hub.promo_claim_reward_subtitle",
        ctaKey: "home_hub.promo_claim_reward_cta",
        route: "/rewards",
        imageUrl: "assets/images/rewards-chest.svg",
        visualAlign: "start",
        chevron: true,
    },
];
