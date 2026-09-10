export function mountPhosphorEffort(options: {
  canvas: HTMLCanvasElement;
  input: HTMLInputElement;
  containers?: HTMLElement[];
  themeRoot?: HTMLElement;
}): {
  update(): void;
  refreshTheme(): void;
  setActive(value: boolean): void;
  destroy(): void;
};
