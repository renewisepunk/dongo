const SAFE_CHILD_ENVIRONMENT_KEYS = [
  "APPDATA",
  "DBUS_SESSION_BUS_ADDRESS",
  "DISPLAY",
  "HOME",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "LOGNAME",
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "USER",
  "USERPROFILE",
  "WAYLAND_DISPLAY",
  "WINDIR",
  "XAUTHORITY",
  "XDG_CURRENT_DESKTOP",
  "XDG_RUNTIME_DIR",
] as const;

export function sanitizedChildEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of SAFE_CHILD_ENVIRONMENT_KEYS) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return { ...environment, ...extra };
}
