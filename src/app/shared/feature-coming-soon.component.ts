import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { TranslocoModule } from "@jsverse/transloco";

@Component({
    selector: "feature-coming-soon",
    standalone: true,
    imports: [CommonModule, TranslocoModule],
    styleUrls: ["./feature-coming-soon.component.scss"],
    template: `
        <div class="zelf-card feature-coming-soon" *transloco="let t">
            <!-- Symmetrical Header (Apps-Hub Pattern) -->
            <div class="feature-coming-soon__header">
                <div class="feature-coming-soon__header-col1">
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
                </div>
                <div class="feature-coming-soon__header-col2">
                    <h1 class="feature-coming-soon__header-title">{{ t(titleKey) }}</h1>
                </div>
                <div class="feature-coming-soon__header-col3" aria-hidden="true"></div>
            </div>

            <!-- Privy Minimalist Hero Body -->
            <div class="feature-coming-soon__body">
                <!-- Squircle Hero Icon Tile -->
                <div class="feature-coming-soon__hero-tile">
                    <svg width="34" height="34" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path
                            d="M18.9125 8.52775L19.973 9.58825L13.25 16.3105L9.5 12.5605L4.5605 17.5H7.25V19H3.5C2.67275 19 2 18.3272 2 17.5V13.75H3.5V16.4395L9.5 10.4395L13.25 14.1895L18.9125 8.52775ZM18.5 1H14.75V2.5H17.4395L12.5 7.4395L8.75 3.6895L2.05625 10.3832L3.11675 11.4438L8.75 5.8105L12.5 9.5605L18.5 3.5605V6.25H20V2.5C20 1.67275 19.3272 1 18.5 1Z"
                            fill="#FD6337"
                        />
                    </svg>
                </div>

                <!-- Glowing Status Pill -->
                <div class="feature-coming-soon__pill">
                    <span class="feature-coming-soon__pill-dot" aria-hidden="true"></span>
                    <span>{{ t('common.coming_soon') }}</span>
                </div>

                <!-- Typography -->
                <h2 class="feature-coming-soon__heading">{{ t('home_hub.signals_heading') }}</h2>
                <p class="feature-coming-soon__description">{{ t(bodyKey) }}</p>

                <!-- Privy-Style Inset Preview Block -->
                <div class="feature-coming-soon__preview">
                    <div class="feature-coming-soon__preview-row">
                        <div class="feature-coming-soon__preview-icon" aria-hidden="true">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                                <polyline points="17 6 23 6 23 12"></polyline>
                            </svg>
                        </div>
                        <div class="feature-coming-soon__preview-text">
                            <p class="feature-coming-soon__preview-title">{{ t('home_hub.signals_placeholder_title') }}</p>
                            <p class="feature-coming-soon__preview-subtitle">{{ t('home_hub.signals_placeholder_body') }}</p>
                        </div>
                    </div>

                    <div class="feature-coming-soon__preview-row">
                        <div class="feature-coming-soon__preview-icon" aria-hidden="true">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                            </svg>
                        </div>
                        <div class="feature-coming-soon__preview-text">
                            <p class="feature-coming-soon__preview-title">{{ t('common.activity') }}</p>
                            <p class="feature-coming-soon__preview-subtitle">{{ t('common.come_back_later') }}</p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Bottom Full-Width High-Contrast CTA Button -->
            <div class="feature-coming-soon__actions">
                <button
                    type="button"
                    (click)="goBack()"
                    class="feature-coming-soon__cta"
                >
                    {{ t('common.back') }}
                </button>
            </div>
        </div>
    `,
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
