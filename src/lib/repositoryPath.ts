import { AxiError } from "axi-sdk-js";

export function validateRepositoryPath(
  path: string,
  flag = "--file",
  retryCommand = "ado-axi pr comment ...",
): void {
  if (/^[a-z]:[\\/]/i.test(path)) {
    throw new AxiError(`${flag} received a Windows path: ${path}`, "VALIDATION_ERROR", [
      "Git Bash may have converted the Azure DevOps repository path",
      `Retry with \`MSYS_NO_PATHCONV=1 ${retryCommand}\``,
      "Repository paths must look like `/src/Project/File.cs`",
    ]);
  }
}
