import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { TranslocoModule } from "@jsverse/transloco";

@Component({
    selector: "feature-coming-soon",
    standalone: true,
    imports: [CommonModule, TranslocoModule],
    template: `
        <div class="zelf-card feature-coming-soon" *transloco="let t">
            <!-- Header with Back Button and Symmetrical Spacer -->
            <div class="feature-coming-soon__header">
                <button
                    type="button"
                    (click)="goBack()"
                    class="zelf-icon-button zelf-icon-button--secondary zelf-icon-button--40"
                    [attr.aria-label]="t('common.back')"
                >
                    <svg width="22" height="14" viewBox="0 0 22 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path
                            d="M20.0898 5.8277H4.72478L8.08478 2.4677C8.53978 2.0127 8.53978 1.2777 8.08478 0.822695C7.62978 0.367695 6.89478 0.367695 6.43978 0.822695L1.08478 6.1777C0.62978 6.6327 0.62978 7.3677 1.08478 7.8227L6.43978 13.1777C6.89478 13.6327 7.62978 13.6327 8.08478 13.1777C8.53978 12.7227 8.53978 11.9877 8.08478 11.5327L4.72478 8.16103H20.0898C20.7314 8.16103 21.2564 7.63603 21.2564 6.99436C21.2564 6.3527 20.7314 5.8277 20.0898 5.8277Z"
                            fill="currentColor"
                        />
                    </svg>
                </button>
                <h1 class="feature-coming-soon__title">{{ t(titleKey) }}</h1>
                <div class="feature-coming-soon__spacer" aria-hidden="true"></div>
            </div>

            <!-- Scrollable Body with Centered Content -->
            <div class="feature-coming-soon__body">
                <div class="feature-coming-soon__hero">
                    <!-- Concentric Glowing Hero Icon Tile -->
                    <div class="feature-coming-soon__aura">
                        <div class="feature-coming-soon__aura-inner">
                            <svg width="34" height="34" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path
                                    d="M18.9125 8.52775L19.973 9.58825L13.25 16.3105L9.5 12.5605L4.5605 17.5H7.25V19H3.5C2.67275 19 2 18.3272 2 17.5V13.75H3.5V16.4395L9.5 10.4395L13.25 14.1895L18.9125 8.52775ZM18.5 1H14.75V2.5H17.4395L12.5 7.4395L8.75 3.6895L2.05625 10.3832L3.11675 11.4438L8.75 5.8105L12.5 9.5605L18.5 3.5605V6.25H20V2.5C20 1.67275 19.3272 1 18.5 1Z"
                                    fill="#FD6337"
                                />
                            </svg>
                        </div>
                    </div>

                    <!-- Coming Soon Pill Badge -->
                    <span class="feature-coming-soon__badge">{{ t("common.coming_soon") }}</span>

                    <!-- Title & Subtitle -->
                    <h2 class="feature-coming-soon__heading">{{ t("home_hub.signals_heading") }}</h2>
                    <p class="feature-coming-soon__description">{{ t(bodyKey) }}</p>
                </div>

                <!-- Feature Highlights Preview Card (Home Hub / Onboarding Style) -->
                <div class="feature-coming-soon__preview-card">
                    <div class="feature-coming-soon__preview-header">
                        <span class="feature-coming-soon__preview-dot" aria-hidden="true"></span>
                        <span class="feature-coming-soon__preview-eyebrow">{{ t("common.zelf_signals") }}</span>
                    </div>
                    <p class="feature-coming-soon__preview-title">{{ t("home_hub.signals_placeholder_title") }}</p>
                    <p class="feature-coming-soon__preview-body">{{ t("home_hub.signals_placeholder_body") }}</p>
                </div>

                <!-- Bottom Action CTA -->
                <div class="feature-coming-soon__actions">
                    <button type="button" class="zelf-button zelf-button--primary feature-coming-soon__btn" (click)="goBack()">
                        {{ t("common.back") }}
                    </button>
                </div>
            </div>
        </div>
    `,
    styles: [`
        @use "../../../styles/variables";
        @use "../../../styles/buttons";

        * {
            box-sizing: border-box;
        }

        :host {
            align-items: center;
            display: flex;
            flex-direction: column;
            flex-grow: 1;
            justify-content: center;
            width: 100%;
            height: 100%;
            min-height: 0;
            max-width: 100%;
            overflow-x: hidden;
            box-sizing: border-box;
        }

        :host-context(.main-div--fullscreen) {
            justify-content: center;
            height: 100%;
            width: 100%;

            .feature-coming-soon {
                height: min(852px, calc(100vh - 160px));
                max-height: min(852px, calc(100vh - 160px));
                min-height: min(580px, calc(100vh - 160px));
                width: min(100%, var(--zns-card-width, 430px));
                border-radius: calc(48px * var(--zns-space-scale, 1));
            }
        }

        :host-context(.main-div--popout) {
            height: 100%;
            width: 100%;

            .feature-coming-soon {
                height: 100% !important;
                max-height: 600px !important;
                min-height: 600px !important;
                width: 100% !important;
                max-width: 375px !important;
                border-radius: 0 !important;
            }
        }

        .feature-coming-soon {
            display: flex;
            flex-direction: column;
            width: min(100%, var(--zns-card-width, 430px));
            height: min(852px, calc(100vh - 160px));
            max-height: min(852px, calc(100vh - 160px));
            min-height: min(580px, calc(100vh - 160px));
            margin: 0 auto;
            border-radius: calc(48px * var(--zns-space-scale, 1));
            border: 1px solid variables.$themeBorder;
            overflow: hidden;
            position: relative;
            box-sizing: border-box;
            background:
                radial-gradient(ellipse 120% 45% at 50% -5%, rgba(253, 99, 55, 0.18) 0%, rgba(253, 99, 55, 0.06) 50%, transparent 100%),
                radial-gradient(ellipse 110% 55% at 50% 105%, rgba(253, 99, 55, 0.08) 0%, rgba(253, 99, 55, 0.03) 55%, transparent 100%),
                linear-gradient(180deg, rgba(253, 99, 55, 0.03) 0%, transparent 45%, rgba(98, 154, 244, 0.04) 100%),
                variables.$themeBackgroundSecondary;
            box-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.45);

            @media screen and (max-width: variables.$medium) {
                width: 100% !important;
                height: 100% !important;
                min-height: 100% !important;
                border-radius: 0 !important;
                padding: 12px !important;
            }

            &__header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: calc(14px * var(--zns-space-scale, 1)) calc(16px * var(--zns-space-scale, 1));
                border-bottom: 1px solid variables.$themeBorder;
                width: 100%;
                flex-shrink: 0;
            }

            &__title {
                flex: 1;
                text-align: center;
                font-weight: 600;
                font-size: calc(16px * var(--zns-font-scale, 1));
                color: variables.$themeText;
                margin: 0;
                letter-spacing: -0.01em;
            }

            &__spacer {
                width: 40px;
                flex-shrink: 0;
            }

            &__body {
                flex: 1;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: space-between;
                padding: calc(28px * var(--zns-space-scale, 1)) calc(20px * var(--zns-space-scale, 1)) calc(20px * var(--zns-space-scale, 1));
                overflow-y: auto;
                width: 100%;
                min-height: 0;
            }

            &__hero {
                display: flex;
                flex-direction: column;
                align-items: center;
                text-align: center;
                width: 100%;
            }

            &__aura {
                width: 84px;
                height: 84px;
                border-radius: 28px;
                background: rgba(253, 99, 54, 0.08);
                border: 1px solid rgba(253, 99, 54, 0.16);
                display: flex;
                align-items: center;
                justify-content: center;
                margin-bottom: calc(16px * var(--zns-space-scale, 1));
                box-shadow: 0 12px 32px -8px rgba(253, 99, 54, 0.25);
            }

            &__aura-inner {
                width: 60px;
                height: 60px;
                border-radius: 20px;
                background: rgba(253, 99, 54, 0.14);
                border: 1px solid rgba(253, 99, 54, 0.28);
                display: flex;
                align-items: center;
                justify-content: center;
            }

            &__badge {
                display: inline-flex;
                align-items: center;
                padding: 4px 12px;
                background: rgba(253, 99, 54, 0.12);
                border: 1px solid rgba(253, 99, 54, 0.28);
                border-radius: 100px;
                color: #FD6337;
                font-size: calc(11px * var(--zns-font-scale, 1));
                font-weight: 600;
                letter-spacing: 0.08em;
                text-transform: uppercase;
                margin-bottom: calc(12px * var(--zns-space-scale, 1));
            }

            &__heading {
                font-size: calc(22px * var(--zns-font-scale, 1));
                font-weight: 700;
                color: variables.$themeText;
                margin: 0 0 calc(8px * var(--zns-space-scale, 1));
                letter-spacing: -0.02em;
            }

            &__description {
                font-size: calc(14px * var(--zns-font-scale, 1));
                color: variables.$themeTextMuted;
                max-width: 320px;
                margin: 0 0 calc(20px * var(--zns-space-scale, 1));
                line-height: 1.5;
            }

            &__preview-card {
                width: 100%;
                padding: calc(14px * var(--zns-space-scale, 1)) calc(16px * var(--zns-space-scale, 1));
                border-radius: 16px;
                border: 1px solid variables.$themeBorder;
                background: rgba(255, 255, 255, 0.02);
                text-align: left;
                margin-bottom: calc(16px * var(--zns-space-scale, 1));
            }

            &__preview-header {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 6px;
            }

            &__preview-dot {
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: #FD6337;
                box-shadow: 0 0 8px #FD6337;
            }

            &__preview-eyebrow {
                font-size: calc(11px * var(--zns-font-scale, 1));
                font-weight: 600;
                color: variables.$themeTextSecondary;
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }

            &__preview-title {
                margin: 0 0 4px;
                font-size: calc(14px * var(--zns-font-scale, 1));
                font-weight: 600;
                color: variables.$themeText;
            }

            &__preview-body {
                margin: 0;
                font-size: calc(12px * var(--zns-font-scale, 1));
                color: variables.$themeTextMuted;
                line-height: 1.45;
            }

            &__actions {
                width: 100%;
                margin-top: auto;
                padding-top: calc(12px * var(--zns-space-scale, 1));
            }

            &__btn {
                width: 100%;
                padding: calc(14px * var(--zns-space-scale, 1)) calc(20px * var(--zns-space-scale, 1));
                border-radius: 16px;
                font-weight: 600;
                font-size: calc(14px * var(--zns-font-scale, 1));
            }
        }
    `]
})
export class FeatureComingSoonComponent implements OnInit {
    titleKey: string = "common.zelf_signals";
    bodyKey: string = "common.zelf_signals_coming_soon";

    constructor(
        private route: ActivatedRoute,
        private router: Router
    ) {}

    ngOnInit(): void {
        this.route.data.subscribe((data) => {
            if (data["titleKey"]) this.titleKey = data["titleKey"];
            if (data["bodyKey"]) this.bodyKey = data["bodyKey"];
        });
    }

    goBack(): void {
        if (typeof window !== "undefined" && window.history.length > 1) {
            window.history.back();
        } else {
            void this.router.navigate(["/home"]);
        }
    }
}
