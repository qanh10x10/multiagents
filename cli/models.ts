import { listModels } from "../shared/model-providers.ts";

export const MODELS_HELP = `multiagents models --file <path> [--json]

  List providers and models from a local VS Code chatLanguageModels.json catalog.
  Relative paths resolve from the current directory. No broker, network, or keys required.
  Outputs allowlisted metadata and credential environment variable names, never key values.
  Catalog capabilities are declarations, not verified provider guarantees.

  Options:
    --file <path>   Required catalog file
    --json          Output the safe catalog as JSON
    --help, -h      Show this help

  Example:
    bun cli.ts models --file .multiagents/chatLanguageModels.json --json`;

function usageError(): void {
  console.error("Invalid models arguments. Usage: multiagents models --file <path> [--json]");
  process.exitCode = 1;
}

export async function modelsCommand(args: string[]): Promise<void> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    console.log(MODELS_HELP);
    return;
  }

  let filePath: string | undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--file" && filePath === undefined) {
      const value = args[++i];
      if (!value?.trim() || value.startsWith("-")) {
        usageError();
        return;
      }
      filePath = value;
    } else if (arg === "--json" && !json) {
      json = true;
    } else {
      usageError();
      return;
    }
  }
  if (filePath === undefined) {
    usageError();
    return;
  }

  try {
    const catalog = await listModels(filePath, process.cwd());
    if (json) {
      console.log(JSON.stringify(catalog, null, 2));
      return;
    }
    console.log("Provider models (catalog metadata is unverified):");
    if (catalog.models.length === 0) console.log("  No models found.");
    for (const model of catalog.models) {
      console.log(`  ${model.provider} / ${model.model} (${model.name})`);
      console.log(`    Credential environment: ${model.envKey}`);
      console.log(`    Tool calling: ${model.toolCalling === undefined ? "unspecified" : model.toolCalling ? "declared" : "disabled"}`);
    }
  } catch {
    // Filesystem errors and catalog contents can contain credentials; never echo them.
    console.error("Cannot list models. Check the catalog file and supported provider/model fields.");
    process.exitCode = 1;
  }
}