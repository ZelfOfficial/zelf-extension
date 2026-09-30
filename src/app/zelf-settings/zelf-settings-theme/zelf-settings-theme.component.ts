import { CommonModule } from "@angular/common";
import { Component, OnDestroy, OnInit } from "@angular/core";
import { TranslocoModule } from "@jsverse/transloco";
import { Subject, takeUntil } from "rxjs";

import { ThemeService } from "app/theme.service";

type UserModePreference = "system" | "dark" | "light";

interface ThemeOption {
    id: UserModePreference;
    labelKey: string;
    icon: string;
}

@Component({
    selector: "zelf-settings-theme",
    standalone: true,
    imports: [CommonModule, TranslocoModule],
    templateUrl: "./zelf-settings-theme.component.html",
    styleUrls: ["./zelf-settings-theme.component.scss"],
})
export class ZelfSettingsThemeComponent implements OnInit, OnDestroy {
    private readonly _destroy$ = new Subject<void>();

    activeMode: UserModePreference = "system";

    readonly themeOptions: ThemeOption[] = [
        { id: "system", labelKey: "settings.theme.system", icon: "brightness_auto" },
        { id: "light", labelKey: "settings.theme.light", icon: "light_mode" },
        { id: "dark", labelKey: "settings.theme.dark", icon: "dark_mode" },
    ];

    constructor(private readonly _themeService: ThemeService) {}

    ngOnInit(): void {
        this._themeService.currentMode$.pipe(takeUntil(this._destroy$)).subscribe((mode) => {
            this.activeMode = mode;
        });
    }

    ngOnDestroy(): void {
        this._destroy$.next();
        this._destroy$.complete();
    }

    async setActiveMode(mode: UserModePreference): Promise<void> {
        await this._themeService.setUserModePreference(mode);
    }
}
