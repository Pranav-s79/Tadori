/**
 * Rename/move coalescing (09-02) now lives in @tadori/store (alongside
 * EdgeDiffRow / diffSnapshotEdges) so the server route and the harness
 * fixture-04 comparison share one implementation — no harness→server
 * dependency, no duplicate matcher. Re-exported here so existing server
 * imports (`../coalescing.js`) keep working.
 */
export {
  buildCoalescedChanges,
  coalesceEdges,
  stageAMatch,
  stageBMatch,
  unqualifiedName,
  type AmbiguousNodeGroup,
  type CoalescedChange,
  type EdgePair,
  type NodePairCandidate
} from "@tadori/store";
