import { Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet],
  template: `
    <header
      class="mx-auto flex max-w-2xl items-center justify-between px-4 pt-6 text-zinc-900 dark:text-zinc-100"
    >
      <a routerLink="/" class="text-lg font-semibold tracking-tight">Bankapp</a>
      <a routerLink="/banker" aria-label="Banker" class="rounded-lg p-2 hover:bg-zinc-200/60">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="size-6"
          aria-hidden="true"
        >
          <path d="M3 10 12 4l9 6" />
          <path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" />
          <path d="M3 21h18" />
        </svg>
      </a>
    </header>
    <router-outlet />
  `,
})
export class App {}
