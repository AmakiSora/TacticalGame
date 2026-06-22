import { AutoControlController } from './controller.js';

let controller: AutoControlController | null = null;

export function getAutoControlController(): AutoControlController {
  controller ??= new AutoControlController();
  return controller;
}

export function resetAutoControlController(): void {
  controller = null;
}
