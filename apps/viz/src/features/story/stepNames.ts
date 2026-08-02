import { fetchNodeDetail } from "../inspect/inspectApi.ts";

export interface StepName {
  displayName: string | null;
  qualifiedName: string | null;
}

/**
 * `GET /story/route/:key` carries each step's entityKey, kind and evidence, but
 * no display name. The step headings therefore rendered as 64-character hex
 * digests — "method: 992a39f495eb362069800c9d825f3d501bd9892e…" — which makes
 * a behaviour trace impossible to study or recall.
 *
 * The entity endpoint the inspector already uses does know the names, so this
 * resolves them client-side. No API contract changes and no new endpoint.
 *
 * A key that does not resolve is recorded with null names rather than omitted:
 * the caller has to be able to tell "not looked up yet" from "looked up, and
 * this snapshot does not carry it", and say the second one out loud.
 */
export async function resolveStepNames(
  entityKeys: readonly string[]
): Promise<ReadonlyMap<string, StepName>> {
  const unresolved: StepName = { displayName: null, qualifiedName: null };
  const entries = await Promise.all(
    [...new Set(entityKeys)].map(async (entityKey): Promise<[string, StepName]> => {
      try {
        const result = await fetchNodeDetail(entityKey);
        return result.status === "ok"
          ? [entityKey, {
              displayName: result.node.displayName,
              qualifiedName: result.node.qualifiedName
            }]
          : [entityKey, unresolved];
      } catch {
        return [entityKey, unresolved];
      }
    })
  );
  return new Map(entries);
}
