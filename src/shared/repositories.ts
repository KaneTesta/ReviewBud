import type { RepositorySummary } from "./types.js";

export function filterRepositories(
  repositories: RepositorySummary[],
  query: string,
  owner = "",
): RepositorySummary[] {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedOwner = owner.trim().toLowerCase();

  return repositories.filter((repository) => {
    if (normalizedOwner && repository.owner.toLowerCase() !== normalizedOwner) {
      return false;
    }
    if (!normalizedQuery) return true;

    const searchableText = `${repository.fullName} ${repository.description}`.toLowerCase();
    return searchableText.includes(normalizedQuery);
  });
}

export function repositoryOwners(repositories: RepositorySummary[]): string[] {
  return [...new Set(repositories.map((repository) => repository.owner))]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}
