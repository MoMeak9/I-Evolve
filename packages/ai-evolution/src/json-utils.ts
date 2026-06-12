/**
 * Extract the first JSON object/array from a model response.
 * Models often wrap JSON in markdown fences or prose.
 */
export function extractJson<T = unknown>(text: string): T {
  const trimmed = text.trim();

  // Strip markdown code fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;

  try {
    return JSON.parse(candidate) as T;
  } catch {
    // Fall back to locating the first balanced object/array
    const start = candidate.search(/[[{]/);
    if (start === -1) throw new Error('No JSON found in model response');
    const slice = candidate.slice(start);
    return JSON.parse(slice) as T;
  }
}
