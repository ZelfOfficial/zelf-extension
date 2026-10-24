import { Subject, takeUntil } from "rxjs";

import { CommonModule } from "@angular/common";
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from "@angular/core";
import { NavigationEnd, Router, RouterModule } from "@angular/router";

@Component({
    imports: [CommonModule, RouterModule],
    selector: "zelf-app",
    styleUrls: ["./zelf-app.component.scss"],
    templateUrl: "./zelf-app.component.html",
})
export class ZelfAppComponent implements AfterViewInit, OnDestroy {
    @ViewChild("contentContainer", { static: false }) contentContainer!: ElementRef<HTMLDivElement>;

    private unsubscriber$: Subject<void> = new Subject<void>();

    backgroundPattern: "gradient-dots" | "falling-pattern" = "falling-pattern";

    constructor(private _router: Router) {}

    ngAfterViewInit(): void {
        this._router.events.pipe(takeUntil(this.unsubscriber$)).subscribe((event) => {
            if (event instanceof NavigationEnd) {
                this.contentContainer?.nativeElement.scrollTo(0, 0);
            }
        });
    }

    ngOnDestroy(): void {
        this.unsubscriber$.next();
        this.unsubscriber$.complete();
    }
}
