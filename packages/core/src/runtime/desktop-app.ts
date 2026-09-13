export const CCR_DESKTOP_APP_ENV = "CCR_DESKTOP_APP";

// Lets a Node test exercise the desktop-app code paths, which otherwise require
// an Electron process. Set only by tests that stand in for the desktop shell.
export const CCR_DESKTOP_APP_FORCE_ENV = "CCR_DESKTOP_APP_FORCE";

export function markDesktopAppRuntime(): void {
  process.env[CCR_DESKTOP_APP_ENV] = "1";
}

export function isDesktopAppRuntime(): boolean {
  if (process.env[CCR_DESKTOP_APP_ENV] !== "1") {
    return false;
  }
  return Boolean((process.versions as NodeJS.ProcessVersions & { electron?: string }).electron) ||
    process.env[CCR_DESKTOP_APP_FORCE_ENV] === "1";
}
