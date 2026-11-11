import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from "@angular/material/bottom-sheet";

import { PasswordShareSheetComponent, PasswordShareSheetData } from "../zelf-keys/zelf-keys-passwords/password-share/password-share-sheet.component";
import { PasswordSharesListComponent } from "../zelf-keys/zelf-keys-passwords/password-share/password-shares-list.component";
import { CreatedPasswordShare, CreatePasswordShareInput, PasswordShareService, PasswordShareSummary } from "../zelf-keys/zelf-keys-passwords/password-share/password-share.service";

const PREVIEW_LINK = "https://zelf.world/share/qa-demo-share#a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6";

const PREVIEW_SHARES: PasswordShareSummary[] = [
    {
        id: "qa-demo-share",
        label: "Example Mail",
        expiresAt: "2026-12-03T21:40:00.000Z",
        maxViews: 1,
        remainingViews: 1,
        createdAt: "2026-11-11T12:00:00.000Z",
    },
    {
        id: "qa-demo-wiki",
        label: "Team wiki",
        expiresAt: "2026-11-18T15:00:00.000Z",
        maxViews: 10,
        remainingViews: 4,
        createdAt: "2026-11-11T12:00:00.000Z",
    },
];

function previewView(): "sheet" | "result" | "list" {
    const query = (typeof location !== "undefined" ? location.hash.split("?")[1] : "") || "";
    const view = new URLSearchParams(query).get("view");
    if (view === "result" || view === "list") return view;
    return "sheet";
}

function previewSheetData(): PasswordShareSheetData {
    const data: PasswordShareSheetData = {
        title: "Example Mail",
        username: "demo.user@example.com",
        password: "synthetic-password",
        url: "https://example.com",
        notes: "Synthetic QA note",
    };

    if (previewView() === "result") {
        return {
            ...data,
            initialView: "result",
            previewLink: PREVIEW_LINK,
            previewExpiresAt: "2026-12-03T21:40:00.000Z",
            previewMaxViews: 1,
        };
    }

    return data;
}

const previewShareApi = {
    async createShare(input: CreatePasswordShareInput): Promise<CreatedPasswordShare> {
        return {
            id: "qa-demo-share",
            expiresAt: "2026-12-03T21:40:00.000Z",
            maxViews: input.maxViews,
            link: PREVIEW_LINK,
        };
    },
    async listShares(): Promise<PasswordShareSummary[]> {
        return PREVIEW_SHARES.map((share) => ({ ...share }));
    },
    async revokeShare(id: string): Promise<void> {
        const index = PREVIEW_SHARES.findIndex((share) => share.id === id);
        if (index >= 0) PREVIEW_SHARES.splice(index, 1);
    },
    translateError(): string {
        return "Could not update the share.";
    },
};

@Component({
    selector: "password-share-preview",
    imports: [CommonModule, PasswordShareSheetComponent, PasswordSharesListComponent],
    providers: [
        { provide: PasswordShareService, useValue: previewShareApi },
        { provide: MAT_BOTTOM_SHEET_DATA, useFactory: previewSheetData },
        { provide: MatBottomSheetRef, useValue: { dismiss() {} } },
    ],
    template: `
        <div class="share-preview">
            <div class="share-preview__phone">
                <password-share-sheet *ngIf="view !== 'list'"></password-share-sheet>
                <password-shares-list *ngIf="view === 'list'"></password-shares-list>
            </div>
        </div>
    `,
    styles: [
        `
            :host {
                display: block;
                min-height: 100vh;
                background: #ececf1;
            }

            .share-preview {
                padding: 28px 16px 40px;
            }

            .share-preview__phone {
                width: min(402px, 100%);
                margin: 0 auto;
                padding: 16px 16px 24px;
                box-sizing: border-box;
                background: #fff;
                border-radius: 28px;
                box-shadow: 0 16px 50px rgba(24, 24, 24, 0.16);
            }
        `,
    ],
})
export class PasswordSharePreviewComponent {
    readonly view = previewView();
}
