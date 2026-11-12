// Entry point. node:sqlite still prints an ExperimentalWarning on some Node versions;
// filter just that one (cross-platform, no NODE_OPTIONS needed), then start the app.
const emit = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const msg = typeof warning === "string" ? warning : warning.message;
  if (msg.includes("SQLite is an experimental feature")) return;
  return (emit as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

const { prepareAndDropPrivileges } = await import("./privileges.js");
prepareAndDropPrivileges();
await import("./index.js");
