import { useCallback, useRef, useState } from "react";
import { fetchFileEdges, fetchFileLayout, fetchFileNodes } from "../api/client.ts";
import type { ApiEdge, ApiNode, LayoutPositionDto } from "../api/types.ts";

export interface FileLevelData {
  nodes: ApiNode[];
  edges: ApiEdge[];
  positions: LayoutPositionDto[];
}

export interface UsePackageExpansionResult {
  expandedPackages: ReadonlySet<string>;
  /** Loaded file-level data per package (cached; survives collapse/re-expand). */
  fileData: ReadonlyMap<string, FileLevelData>;
  expand: (packageKey: string) => Promise<void>;
  collapse: (packageKey: string) => void;
}

/**
 * Tracks which packages are expanded and lazily loads each package's
 * file-level nodes/edges/positions on first expand. Loaded data is cached in a
 * ref keyed by package, so collapsing then re-expanding a package issues zero
 * additional fetches (the ref persists across renders and is not cleared on
 * collapse — collapse only removes the package from `expandedPackages`).
 */
export function usePackageExpansion(): UsePackageExpansionResult {
  const [expandedPackages, setExpandedPackages] = useState<ReadonlySet<string>>(new Set());
  // Cache lives in a ref (not state): its identity/content must not trigger
  // re-renders on its own, and it must survive collapse so re-expand is free.
  const cacheRef = useRef<Map<string, FileLevelData>>(new Map());
  // Mirror the cache into state only to expose a stable, render-visible Map.
  const [fileData, setFileData] = useState<ReadonlyMap<string, FileLevelData>>(new Map());

  const expand = useCallback(async (packageKey: string): Promise<void> => {
    if (!cacheRef.current.has(packageKey)) {
      const [nodes, edges, positions] = await Promise.all([
        fetchFileNodes(packageKey),
        fetchFileEdges(packageKey),
        fetchFileLayout(packageKey)
      ]);
      cacheRef.current.set(packageKey, { nodes, edges, positions });
      setFileData(new Map(cacheRef.current));
    }
    setExpandedPackages((prev) => {
      if (prev.has(packageKey)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(packageKey);
      return next;
    });
  }, []);

  const collapse = useCallback((packageKey: string): void => {
    setExpandedPackages((prev) => {
      if (!prev.has(packageKey)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(packageKey);
      return next;
    });
  }, []);

  return { expandedPackages, fileData, expand, collapse };
}
